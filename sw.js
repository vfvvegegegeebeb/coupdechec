/* ══════════════════════════════════════════════
   CoupDEchec — Service Worker
   Cache statique + stratégie cache-first
══════════════════════════════════════════════ */
const CACHE = 'coupdechec-v1';

const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/position-du-jour',
  '/position-du-jour.html',
  '/manifest.json',
  '/favicon.svg',
  '/favicon-32.png',
  '/favicon-192.png',
  '/stockfish.js',
  /* pièces */
  '/pieces/wK.webp', '/pieces/wQ.webp', '/pieces/wR.webp',
  '/pieces/wB.webp', '/pieces/wN.webp', '/pieces/wP.webp',
  '/pieces/bK.webp', '/pieces/bQ.webp', '/pieces/bR.webp',
  '/pieces/bB.webp', '/pieces/bN.webp', '/pieces/bP.webp',
  '/pieces/wK.png',  '/pieces/wQ.png',  '/pieces/wR.png',
  '/pieces/wB.png',  '/pieces/wN.png',  '/pieces/wP.png',
  '/pieces/bK.png',  '/pieces/bQ.png',  '/pieces/bR.png',
  '/pieces/bB.png',  '/pieces/bN.png',  '/pieces/bP.png'
];

/* ── Installation : mise en cache initiale ── */
self.addEventListener('install', function(e) {
  e.waitUntil(
    caches.open(CACHE).then(function(cache) {
      /* addAll échoue en bloc si une ressource manque — on cache individuellement */
      return Promise.allSettled(
        STATIC_ASSETS.map(function(url) {
          return cache.add(url).catch(function() { /* ignore les 404 */ });
        })
      );
    }).then(function() { return self.skipWaiting(); })
  );
});

/* ── Activation : supprime les vieux caches ── */
self.addEventListener('activate', function(e) {
  e.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys.filter(function(k) { return k !== CACHE; })
            .map(function(k)   { return caches.delete(k); })
      );
    }).then(function() { return self.clients.claim(); })
  );
});

/* ── Fetch : cache-first, réseau en fallback ── */
self.addEventListener('fetch', function(e) {
  /* On ne gère que les GET HTTP(S) ; on ignore les requêtes Supabase/analytics */
  if (e.request.method !== 'GET') return;
  var url = new URL(e.request.url);
  if (url.hostname !== location.hostname) return;

  e.respondWith(
    caches.match(e.request).then(function(cached) {
      if (cached) return cached;
      return fetch(e.request).then(function(response) {
        /* Ne cache que les réponses valides */
        if (!response || response.status !== 200 || response.type === 'opaque') {
          return response;
        }
        var clone = response.clone();
        caches.open(CACHE).then(function(cache) { cache.put(e.request, clone); });
        return response;
      }).catch(function() {
        /* Hors ligne et non en cache : renvoie index.html pour navigation */
        if (e.request.mode === 'navigate') {
          return caches.match('/index.html');
        }
      });
    })
  );
});
