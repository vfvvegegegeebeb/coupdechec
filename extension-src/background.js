'use strict';

// ── Stockfish bridge ────────────────────────────────────────────────────────

let _sfSend    = null;   // handler onmessage de Stockfish
let _state     = 'init'; // 'init' | 'ready'
let _queue     = null;   // requête ANALYZE en attente pendant l'init
let _pending   = null;   // requête en cours { resolve, timeout }
let _lastScore = null;   // score UCI de la dernière ligne info

// ── Étape 1 : intercepter la sortie de Stockfish ────────────────────────────
self.postMessage = function (data) {
  if (typeof data !== 'string') return;

  if (data === 'readyok') {
    _state = 'ready';
    if (_queue) { _runAnalysis(_queue); _queue = null; }
    return;
  }

  if (data.startsWith('info')) {
    const m = data.match(/score (cp|mate) (-?\d+)/);
    if (m) {
      if (m[1] === 'cp') {
        const cp = parseInt(m[2]);
        _lastScore = (cp >= 0 ? '+' : '') + (cp / 100).toFixed(1);
      } else {
        const n = parseInt(m[2]);
        _lastScore = '#' + (n > 0 ? n : n);
      }
    }
    return;
  }

  if (data.startsWith('bestmove')) {
    const move  = data.split(' ')[1];
    const score = _lastScore;
    _lastScore  = null;
    if (_pending) {
      clearTimeout(_pending.timeout);
      const resolve = _pending.resolve;
      _pending = null;
      resolve(move && move !== '(none)' ? { move, score } : null);
    }
  }
};

// ── Étape 2 : charger Stockfish pure JS ─────────────────────────────────────
try {
  importScripts('stockfish.js');
} catch (_) {}

// ── Étape 3 : capturer le handler de Stockfish ──────────────────────────────
_sfSend = self.onmessage || null;
self.onmessage = null;

// ── Étape 4 : initialisation UCI ────────────────────────────────────────────
function _uci(cmd) {
  if (_sfSend) _sfSend.call(self, { data: cmd });
}

_uci('uci');
_uci('isready');

// Niveau de jeu courant (1–20)
let _skillLevel = 20;
chrome.storage.local.get(['skill'], (d) => {
  if (d.skill != null) _skillLevel = d.skill;
});

// ── Analyse ──────────────────────────────────────────────────────────────────
function _runAnalysis(req) {
  _lastScore = null;
  _uci('stop');
  _uci('setoption name Skill Level value ' + _skillLevel);
  _uci('position fen ' + req.fen);

  // Pour les parties en direct : movetime (contrainte de temps)
  // Pour l'analyse libre : depth (profondeur fixe adaptée à l'ELO)
  if (req.depth && !req.live) {
    _uci('go depth ' + req.depth);
  } else {
    _uci('go movetime ' + req.movetime);
  }

  // Timeout de sécurité : depth peut prendre plus longtemps
  var maxWait = req.depth && !req.live
    ? req.depth * 800 + 2000   // ~800ms par ply + marge
    : req.movetime + 3000;

  _pending = {
    resolve: req.resolve,
    timeout: setTimeout(function () {
      if (_pending && _pending.resolve === req.resolve) {
        _pending = null;
        req.resolve(null);
      }
    }, maxWait)
  };
}

function _analyze(fen, movetime, depth, live) {
  return new Promise(function (resolve) {
    if (_pending) {
      clearTimeout(_pending.timeout);
      const old = _pending.resolve;
      _pending = null;
      old(null);
    }
    const req = { fen, movetime, depth: depth || null, live: !!live, resolve };
    if (_state === 'ready') {
      _runAnalysis(req);
    } else {
      _queue = req;
    }
  });
}

// ── Messages depuis content.js ───────────────────────────────────────────────
chrome.runtime.onMessage.addListener(function (msg, _sender, sendResponse) {
  if (msg.type === 'ANALYZE') {
    _analyze(
      msg.fen,
      msg.movetime || 1000,
      msg.depth    || null,
      msg.live     || false
    ).then(function (result) {
      sendResponse(result || { move: null, score: null });
    });
    return true; // réponse asynchrone
  }

  if (msg.type === 'SF_STOP') {
    _uci('stop');
    if (_pending) { clearTimeout(_pending.timeout); _pending = null; }
    sendResponse({ ok: true });
  }

  if (msg.type === 'SET_SKILL') {
    _skillLevel = Math.max(1, Math.min(20, msg.level));
    chrome.storage.local.set({ skill: _skillLevel });
    sendResponse({ ok: true });
  }

  if (msg.type === 'PING') {
    sendResponse({ ok: true });
  }
});
