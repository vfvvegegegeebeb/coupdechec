/* chess.com — analyse locale Stockfish avec adaptation ELO */
(function () {
  'use strict';

  // Délai d'injection aléatoire : réduit la signature temporelle du script
  setTimeout(function () {

  // ── État interne — zéro variable dans window ──────────────────────────────
  var _on    = false;  // analyse active
  var _C     = null;   // <canvas> overlay (dans Shadow DOM)
  var _Ch    = null;   // host element du canvas shadow
  var _SHb   = null;   // shadow root du bouton (mode:closed)
  var _Bh    = null;   // host element du bouton
  var _O     = null;   // MutationObserver sur le board
  var _Ro    = null;   // ResizeObserver
  var _raf   = null;   // requestAnimationFrame id
  var _T     = null;   // debounce timer DOM
  var _D     = null;   // timer d'affichage de la flèche
  var _F     = null;   // dernier FEN analysé
  var _M     = null;   // dernier bestmove reçu
  var _Gen   = 0;      // génération d'analyse (ignore les réponses périmées)
  var _Mpre  = null;   // bestmove pré-calculé pour le tour adverse
  var _Fpre  = null;   // FEN de la pré-analyse
  var _Score = null;   // score Stockfish (+0.5, #3, …)
  var _Url   = location.href;
  var _Pol   = null;   // polling navigation SPA
  var _Ka    = null;   // keepalive interval

  // ── Adaptation ELO ──────────────────────────────────────────────────────
  var _EloDetected = null;  // ELO trouvé dans le DOM (number|null)
  var _ManualElo   = null;  // ELO entré manuellement par l'utilisateur
  var _Depth       = 12;    // profondeur d'analyse courante
  var _SkillLevel  = 10;    // Stockfish Skill Level courant

  // ── Guards ────────────────────────────────────────────────────────────────
  function _ok() {
    try { return !!(chrome && chrome.runtime && chrome.runtime.id); }
    catch (e) { return false; }
  }
  function _save(obj) {
    try { if (_ok()) chrome.storage.local.set(obj); } catch (e) {}
  }
  function _load(cb) {
    try { if (_ok()) chrome.storage.local.get(['a', 'elo'], cb); } catch (e) {}
  }

  // ── DOM helpers ───────────────────────────────────────────────────────────
  function _board() {
    return document.querySelector('wc-chess-board') ||
           document.querySelector('chess-board');
  }
  function _flipped() {
    var b = _board();
    return b ? (b.classList.contains('flipped') || b.hasAttribute('flipped')) : false;
  }
  function _isLive() {
    return !!document.querySelector('.clock-component, .clock-player-turn');
  }
  function _myColor() { return _flipped() ? 'b' : 'w'; }
  function _myTurn(fen) {
    return !fen || (fen.split(' ')[1] || 'w') === _myColor();
  }
  function _hasBoardPage() {
    return /^\/(game|analysis|play|chess|puzzles|learn)/.test(location.pathname);
  }

  // ── Timing humain (log-normale) ───────────────────────────────────────────
  function _fastDelay() { return (60 + Math.random() * 100) | 0; }
  function _humanDelay() {
    var g = Math.sqrt(-2 * Math.log(Math.random())) * Math.cos(2 * Math.PI * Math.random());
    return Math.max(400, Math.min(5000, Math.exp(Math.log(1200) + 0.55 * g) | 0));
  }
  function _movetime() {
    return _isLive()
      ? (200 + Math.random() * 150 | 0)
      : (1200 + Math.random() * 600 | 0);
  }

  // ── Attente du board (SPA) ────────────────────────────────────────────────
  function _waitBoard(cb) {
    var el = _board();
    if (el) { cb(el); return; }
    var wo = new MutationObserver(function () {
      var el = _board(); if (!el) return;
      wo.disconnect(); cb(el);
    });
    wo.observe(document.body, { childList: true, subtree: true });
  }

  // ── Lecture FEN depuis le DOM chess.com ───────────────────────────────────
  function _readFEN() { return _fen1() || _fen2() || _fen3() || null; }

  function _emptyGrid() {
    var g = [];
    for (var i = 0; i < 8; i++) { g[i] = new Array(8).fill(''); }
    return g;
  }

  function _gridToFEN(g, b) {
    var flat = g.map(function (r) { return r.join(''); }).join('');
    if (!flat.includes('K') || !flat.includes('k')) return null;
    var fen = '';
    for (var r = 7; r >= 0; r--) {
      var e = 0;
      for (var f = 0; f < 8; f++) {
        if (g[r][f]) { if (e) { fen += e; e = 0; } fen += g[r][f]; }
        else e++;
      }
      if (e) fen += e;
      if (r > 0) fen += '/';
    }
    return fen + ' ' + _turn(b) + ' KQkq - 0 1';
  }

  function _turn(b) {
    var fl = b.classList.contains('flipped') || b.hasAttribute('flipped');
    var cl = document.querySelectorAll('.clock-player-turn');
    if (cl.length)
      return cl[0].classList.contains('clock-bottom') ? (fl ? 'b' : 'w') : (fl ? 'w' : 'b');
    var sel = document.querySelector('.selected-move');
    if (sel) return (sel.closest && sel.closest('.white')) ? 'b' : 'w';
    return 'w';
  }

  function _fen1() {
    var b = _board(); if (!b) return null;
    var g = _emptyGrid();
    b.querySelectorAll('.piece').forEach(function (el) {
      var cls = el.className.split(' ');
      var sq = null, pc = null;
      for (var c of cls) {
        if (/^square-\d{2}$/.test(c)) sq = c;
        if (/^[wb][prnbqk]$/.test(c))  pc = c;
      }
      if (!sq || !pc) return;
      var fi = sq.charCodeAt(7) - 49;
      var ri = sq.charCodeAt(8) - 49;
      if (fi >= 0 && fi < 8 && ri >= 0 && ri < 8)
        g[ri][fi] = pc[0] === 'w' ? pc[1].toUpperCase() : pc[1];
    });
    return _gridToFEN(g, b);
  }

  function _fen2() {
    var b = _board(); if (!b) return null;
    var g = _emptyGrid();
    b.querySelectorAll('[data-piece]').forEach(function (el) {
      var dp = el.getAttribute('data-piece'); if (!dp || dp.length < 2) return;
      var sq = el.getAttribute('data-square') || ''; if (!sq) return;
      var fi = sq.charCodeAt(0) - 97;
      var ri = parseInt(sq[1]) - 1;
      if (isNaN(ri) || fi < 0 || fi > 7 || ri < 0 || ri > 7) return;
      g[ri][fi] = dp[0] === 'w' ? dp[1].toUpperCase() : dp[1].toLowerCase();
    });
    return _gridToFEN(g, _board());
  }

  function _fen3() {
    try {
      var cg = window.chessboard || window.game;
      if (cg && typeof cg.getFen === 'function') return cg.getFen();
      if (cg && cg.game && typeof cg.game.getFen === 'function') return cg.game.getFen();
    } catch (_) {}
    return null;
  }

  // ── Lecture ELO du joueur connecté ────────────────────────────────────────
  function _readElo() {
    // Essaie les sélecteurs spécifiques au joueur du bas (= nous)
    var selectors = [
      '.board-player-default .user-tagline-rating',
      '.board-layout-player-bottom .user-tagline-rating',
      '[data-player="bottom"] .user-tagline-rating',
      '.clock-bottom .user-tagline-rating',
      '.player-tagline-rating',
      '.clock-player-turn.clock-bottom .rating',
      '.user-tagline-rating',
    ];
    for (var i = 0; i < selectors.length; i++) {
      var el = document.querySelector(selectors[i]);
      if (!el) continue;
      var text = el.textContent.trim().replace(/[(),\s]/g, '');
      var match = text.match(/\d{3,4}/);
      if (match) {
        var elo = parseInt(match[0]);
        if (elo > 100 && elo < 4000) {
          console.log('[CoupDEchec] ELO détecté via "' + selectors[i] + '" :', elo);
          return elo;
        }
      }
    }
    // Heuristique : scanner tous les éléments contenant "rating" dans leur classe
    var allEls = document.querySelectorAll('[class*="rating"]');
    for (var j = 0; j < allEls.length; j++) {
      var txt = allEls[j].textContent.trim();
      // Ne retenir que les éléments dont le texte est un nombre seul entre 3 et 4 chiffres
      var m2 = txt.match(/^\(?(\d{3,4})\)?$/);
      if (m2) {
        var elo2 = parseInt(m2[1]);
        if (elo2 > 200 && elo2 < 4000) {
          console.log('[CoupDEchec] ELO détecté (heuristique, class*=rating) :', elo2);
          return elo2;
        }
      }
    }
    console.log('[CoupDEchec] ELO non trouvé automatiquement dans le DOM');
    return null;
  }

  // ── ELO → config Stockfish ────────────────────────────────────────────────
  function _eloToConfig(elo) {
    if (elo < 800)  return { depth:  5, skill:  3, label: 'depth 5'  };
    if (elo < 1200) return { depth:  8, skill:  6, label: 'depth 8'  };
    if (elo < 1600) return { depth: 12, skill: 10, label: 'depth 12' };
    if (elo < 2000) return { depth: 16, skill: 15, label: 'depth 16' };
    return               { depth: 20, skill: 20, label: 'depth 20' };
  }

  function _applyEloConfig() {
    var elo = _EloDetected || _ManualElo;
    if (!elo) { _Depth = 12; _SkillLevel = 10; return; }
    var cfg = _eloToConfig(elo);
    _Depth      = cfg.depth;
    _SkillLevel = cfg.skill;
    console.log('[CoupDEchec] Config Stockfish :', elo, 'ELO →', cfg.label,
                '| Skill Level:', cfg.skill);
    try {
      if (_ok()) chrome.runtime.sendMessage({ type: 'SET_SKILL', level: cfg.skill });
    } catch (_) {}
  }

  // ── Stockfish — envoi vers background.js ──────────────────────────────────
  function _analyze(fen, pre) {
    if (!_ok()) return;
    var gen  = ++_Gen;
    var live = _isLive();
    try {
      chrome.runtime.sendMessage(
        { type: 'ANALYZE', fen: fen, movetime: _movetime(),
          depth: _Depth, live: live, pre: !!pre },
        function (res) {
          if (chrome.runtime.lastError) return;
          if (gen !== _Gen) return;
          if (!res || !res.move) return;
          if (pre) {
            _Mpre = res.move; _Fpre = fen;
          } else {
            _M = res.move; _Score = res.score || null;
            _showMove(_M, _Score);
          }
        }
      );
    } catch (_) {}
  }

  function _stopSF() {
    try { if (_ok()) chrome.runtime.sendMessage({ type: 'SF_STOP' }).catch(function(){}); }
    catch (_) {}
  }

  // ── Canvas overlay — injecté dans un Shadow DOM fermé ────────────────────
  function _initCanvas() {
    if (_C) return;
    _Ch = document.createElement('div');
    _Ch.style.cssText = [
      'position:fixed', 'top:0', 'left:0',
      'width:0', 'height:0', 'overflow:visible',
      'pointer-events:none', 'z-index:2147483645'
    ].join(';');
    try {
      _Ch.dataset.r = (typeof crypto !== 'undefined' && crypto.randomUUID)
        ? crypto.randomUUID()
        : Math.random().toString(36).slice(2);
    } catch (_) {}
    document.body.appendChild(_Ch);
    var _ShC = _Ch.attachShadow({ mode: 'closed' });
    _C = document.createElement('canvas');
    _C.style.cssText = [
      'position:fixed', 'top:0', 'left:0',
      'pointer-events:none', 'z-index:2147483645'
    ].join(';');
    _ShC.appendChild(_C);
    _waitBoard(function (b) {
      _Ro = new ResizeObserver(_syncCanvas);
      _Ro.observe(b);
      _syncCanvas();
      (function loop() { _syncCanvas(); _raf = requestAnimationFrame(loop); })();
    });
  }

  function _removeCanvas() {
    if (_Ch) { _Ch.remove(); _Ch = null; }
    _C = null;
    if (_Ro) { _Ro.disconnect(); _Ro = null; }
    if (_raf) { cancelAnimationFrame(_raf); _raf = null; }
  }

  function _syncCanvas() {
    var b = _board(); if (!b || !_C) return;
    var r = b.getBoundingClientRect();
    var w = r.width | 0, h = r.height | 0;
    if (_C.width !== w || _C.height !== h) { _C.width = w; _C.height = h; }
    _C.style.left = r.left + 'px';
    _C.style.top  = r.top  + 'px';
  }

  // ── Flèche dorée ──────────────────────────────────────────────────────────
  function _sqPx(name, sz, flip) {
    var f = name.charCodeAt(0) - 97;
    var r = name.charCodeAt(1) - 49;
    var s = sz / 8;
    return flip
      ? { x: (7 - f + .5) * s, y: (r + .5) * s }
      : { x: (f + .5) * s,     y: (7 - r + .5) * s };
  }

  function _drawArrow(mv) {
    if (!_C || !mv || mv.length < 4 || document.hidden) return;
    _syncCanvas();
    var sz = _C.width; if (!sz) return;
    var sq = sz / 8, fl = _flipped();
    var p1 = _sqPx(mv.slice(0, 2), sz, fl);
    var p2 = _sqPx(mv.slice(2, 4), sz, fl);
    var ang = Math.atan2(p2.y - p1.y, p2.x - p1.x);
    var lw = sq * .13, hl = sq * .44, ha = Math.PI / 5;
    var sx = p1.x + Math.cos(ang) * sq * .28;
    var sy = p1.y + Math.sin(ang) * sq * .28;
    var ex = p2.x - Math.cos(ang) * sq * .18;
    var ey = p2.y - Math.sin(ang) * sq * .18;
    var ctx = _C.getContext('2d');
    ctx.clearRect(0, 0, sz, sz);
    ctx.save();
    ctx.globalAlpha = .85;
    ctx.shadowColor = 'rgba(0,0,0,.45)';
    ctx.shadowBlur  = lw * 1.3;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(ex - Math.cos(ang) * hl * .4, ey - Math.sin(ang) * hl * .4);
    ctx.strokeStyle = '#f0c040'; ctx.lineWidth = lw; ctx.lineCap = 'round';
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(ex, ey);
    ctx.lineTo(ex - hl * Math.cos(ang - ha), ey - hl * Math.sin(ang - ha));
    ctx.lineTo(ex - hl * Math.cos(ang + ha), ey - hl * Math.sin(ang + ha));
    ctx.closePath();
    ctx.fillStyle = '#f0c040'; ctx.fill();
    ctx.restore();
  }

  function _clearArrow() {
    _M = null; _Score = null;
    clearTimeout(_D);
    _updateBtn();
    if (_C) _C.getContext('2d').clearRect(0, 0, _C.width, _C.height);
  }

  function _showMove(mv, sc) {
    var b = _btn();
    if (b) {
      b.innerHTML = '\u265F ' + mv +
        (sc ? '&nbsp;<span style="opacity:.65;font-size:.82em;font-weight:600">' + sc + '</span>' : '');
    }
    clearTimeout(_D);
    if (document.hidden) return;
    _D = setTimeout(function () { _drawArrow(mv); },
      _isLive() ? _fastDelay() : _humanDelay());
  }

  // ── Observer DOM ──────────────────────────────────────────────────────────
  function _startObs() {
    if (_O) return;
    _waitBoard(function (b) {
      if (_O) return;
      _O = new MutationObserver(function () {
        clearTimeout(_T); _T = setTimeout(_doAnalyze, 280);
      });
      _O.observe(b, {
        childList: true, subtree: true,
        attributes: true, attributeFilter: ['class', 'style']
      });
      _doAnalyze();
    });
  }

  function _stopObs() {
    if (_O) { _O.disconnect(); _O = null; }
    clearTimeout(_T);
  }

  // ── Déclenchement analyse ─────────────────────────────────────────────────
  function _doAnalyze() {
    if (!_on || document.hidden) return;
    var fen = _readFEN();
    if (!fen || fen === _F) return;
    _F = fen;
    _clearArrow();
    if (_isLive() && _myTurn(fen)) {
      if (_Mpre && _Fpre === fen) {
        _M = _Mpre; _Mpre = null; _Fpre = null; _showMove(_M);
      } else {
        _analyze(fen, false);
      }
    } else if (_isLive() && !_myTurn(fen)) {
      _analyze(fen, true);
    } else {
      _analyze(fen, false);
    }
  }

  // ── Info panel helpers ─────────────────────────────────────────────────────
  function _btn()    { return _SHb ? _SHb.querySelector('#cde-btn')  : null; }
  function _infoEl() { return _SHb ? _SHb.querySelector('#cde-info') : null; }

  function _updateInfo() {
    var el = _infoEl(); if (!el) return;
    var elo = _EloDetected || _ManualElo;
    if (elo) {
      var cfg = _eloToConfig(elo);
      el.innerHTML =
        '<span style="color:#aaa">Niveau détecté\u00a0: </span>' +
        '<strong>' + elo + ' ELO \u2192 Analyse adaptée (' + cfg.label + ')</strong>';
      el.style.display = '';
    } else {
      // Affiche le slider manuel
      el.innerHTML =
        '<div style="color:#aaa;margin-bottom:4px;font-size:10px;letter-spacing:.5px;text-transform:uppercase">ELO non détecté — entrez votre niveau</div>' +
        '<div style="display:flex;align-items:center;gap:8px">' +
          '<input id="cde-elo-range" type="range" min="400" max="3000" step="50" value="' + (_ManualElo || 1200) + '" ' +
            'style="flex:1;accent-color:#f0c040;cursor:pointer"/>' +
          '<span id="cde-elo-val" style="color:#f0c040;font-weight:800;min-width:36px;text-align:right">' +
            (_ManualElo || 1200) + '</span>' +
        '</div>';
      el.style.display = '';
      var range = el.querySelector('#cde-elo-range');
      var valEl = el.querySelector('#cde-elo-val');
      if (range && valEl) {
        range.addEventListener('input', function () {
          valEl.textContent = range.value;
        });
        range.addEventListener('change', function () {
          var v = parseInt(range.value);
          _ManualElo = v;
          _save({ elo: v });
          _applyEloConfig();
          // Re-render to show the label once value is set
          setTimeout(_updateInfo, 100);
        });
      }
    }
  }

  // ── Bouton flottant — Shadow DOM fermé ────────────────────────────────────
  function _initButton() {
    if (_Bh && document.body.contains(_Bh)) return;
    _Bh = document.createElement('span');
    _Bh.style.cssText =
      'position:fixed;bottom:18px;right:18px;z-index:2147483646;display:block;width:0;height:0';
    document.body.appendChild(_Bh);
    _SHb = _Bh.attachShadow({ mode: 'closed' });

    // Wrapper vertical : info au-dessus, bouton en bas
    var wrapper = document.createElement('div');
    wrapper.style.cssText =
      'position:absolute;bottom:0;right:0;display:flex;flex-direction:column;align-items:flex-end;gap:6px';

    // Panneau ELO
    var info = document.createElement('div');
    info.id = 'cde-info';
    info.style.cssText = [
      'background:#0f0f1a',
      'border:1px solid rgba(240,192,64,.55)',
      'border-radius:7px',
      'padding:7px 11px',
      'font-size:11px',
      'font-family:system-ui,sans-serif',
      'color:#f0c040',
      'white-space:normal',
      'width:230px',
      'line-height:1.4',
      'display:none',
      'box-shadow:0 2px 14px rgba(0,0,0,.6)'
    ].join(';');

    // Bouton toggle
    var b = document.createElement('button');
    b.id = 'cde-btn';
    b.style.cssText = [
      'background:#0f0f1a','color:#f0c040',
      'border:2px solid #f0c040','border-radius:8px',
      'padding:7px 13px','font-size:13px','font-weight:800',
      'font-family:system-ui,sans-serif','cursor:pointer',
      'letter-spacing:.4px','line-height:1','white-space:nowrap',
      'box-shadow:0 2px 14px rgba(0,0,0,.6)'
    ].join(';');
    b.addEventListener('mouseenter', function () { b.style.background='#f0c040'; b.style.color='#111'; });
    b.addEventListener('mouseleave', function () { _updateBtn(b); });
    b.addEventListener('click',      function () { _on ? _disable() : _enable(); });

    wrapper.appendChild(info);
    wrapper.appendChild(b);
    _SHb.appendChild(wrapper);
    _updateBtn(b);
    _updateInfo();
  }

  function _updateBtn(b) {
    b = b || _btn(); if (!b) return;
    b.innerHTML        = _on ? '\u265F ON' : '\u265F Analyse';
    b.style.background = _on ? '#1a1a08' : '#0f0f1a';
    b.style.color      = '#f0c040';
    b.style.boxShadow  = _on
      ? '0 0 14px rgba(240,192,64,.3)'
      : '0 2px 14px rgba(0,0,0,.6)';
  }

  // ── Activer / Désactiver ──────────────────────────────────────────────────
  function _enable() {
    _on = true;
    _save({ a: true });

    // Lecture ELO et application de la config
    _EloDetected = _readElo();
    _applyEloConfig();
    _updateBtn();
    _updateInfo();

    _initCanvas();
    _startObs();
    _doAnalyze();
    if (!_Ka) _Ka = setInterval(function () {
      try { if (_ok()) chrome.runtime.sendMessage({ type: 'PING' }).catch(function(){}); }
      catch (_) {}
    }, 20000);
  }

  function _disable() {
    _on = false;
    _save({ a: false });
    _updateBtn();
    _updateInfo();
    _stopObs();
    _clearArrow();
    _removeCanvas();
    _stopSF();
    ++_Gen;
    if (_Ka) { clearInterval(_Ka); _Ka = null; }
  }

  // ── Navigation SPA ────────────────────────────────────────────────────────
  _Pol = setInterval(function () {
    if (location.href === _Url) return;
    _Url = location.href;
    setTimeout(function () {
      _C = null; _Ch = null; _O = null; _F = null; _Mpre = null; _Fpre = null;
      if (_raf) { cancelAnimationFrame(_raf); _raf = null; }
      if (!_hasBoardPage()) {
        if (_on) { _stopObs(); _on = false; }
        if (_Bh && document.body.contains(_Bh)) { _Bh.remove(); _Bh = null; _SHb = null; }
        return;
      }
      _initButton();
      if (_on) { _initCanvas(); _startObs(); _doAnalyze(); }
      else { _load(function (r) { if (r.a) _enable(); }); }
    }, 1200);
  }, 800);

  // ── Messages (ENABLE/DISABLE depuis d'éventuels scripts de contrôle) ─────
  try {
    chrome.runtime.onMessage.addListener(function (msg) {
      if (msg.type === 'ENABLE')  _enable();
      if (msg.type === 'DISABLE') _disable();
    });
  } catch (_) {}

  // ── Boot ──────────────────────────────────────────────────────────────────
  function _init() {
    if (!_hasBoardPage()) return;
    _initButton();
    _load(function (r) {
      // Restaure l'ELO manuel sauvegardé
      if (r.elo && r.elo > 100) {
        _ManualElo = r.elo;
        _applyEloConfig();
        _updateInfo();
      }
      if (r.a) _enable();
    });
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) _clearArrow();
      else if (_on) _doAnalyze();
    });
    // Raccourci clavier discret : Ctrl+Shift+X → toggle analyse
    document.addEventListener('keydown', function (e) {
      if (e.ctrlKey && e.shiftKey && e.code === 'KeyX') {
        e.preventDefault();
        _on ? _disable() : _enable();
      }
    }, true);
  }

  if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', _init);
  else
    _init();

  }, Math.random() * 600); // fin du setTimeout d'injection aléatoire
})();
