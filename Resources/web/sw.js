/* RummiCard — © 2026 Richard Boulais & Claude */
/* =====================================================================
   sw.js — permet de rejouer sans réseau.
   Stratégie : le réseau d'abord, le cache en secours. Connecté, on reçoit
   toujours la version du jour ; hors ligne ou si le serveur tarde, on sert
   la dernière version connue. L'ancienne stratégie servait le cache en
   premier : la partie se lançait instantanément, mais avec la version
   d'avant, et il fallait recharger deux fois pour voir une nouveauté.
   ===================================================================== */
var CACHE = 'rummicard-3';
var ATTENTE = 3000;          // au-delà, on n'attend plus le serveur
var SHELL = [
  './', 'index.html', 'style.css',
  'i18n.js', 'solver.js', 'engine.js', 'ai.js', 'ui.js',
  'manifest.webmanifest',
  'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (c) { return c.addAll(SHELL); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (noms) {
      return Promise.all(noms.map(function (n) {
        return n === CACHE ? null : caches.delete(n);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(
    caches.open(CACHE).then(function (cache) {
      return cache.match(req).then(function (cached) {
        var reseau = fetch(req).then(function (rep) {
          if (rep && rep.ok) cache.put(req, rep.clone());
          return rep;
        });
        if (!cached) return reseau;
        /* Le réseau est servi s'il répond dans le délai ; sinon le cache
           prend le relais, et la réponse du serveur alimentera tout de même
           le cache pour la prochaine fois. */
        return new Promise(function (resolve) {
          var fini = false;
          var minuteur = setTimeout(function () {
            if (!fini) { fini = true; resolve(cached); }
          }, ATTENTE);
          reseau.then(function (rep) {
            if (!fini) { fini = true; clearTimeout(minuteur); resolve(rep); }
          }).catch(function () {
            if (!fini) { fini = true; clearTimeout(minuteur); resolve(cached); }
          });
        });
      });
    })
  );
});
