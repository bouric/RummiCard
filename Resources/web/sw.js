/* RummiCard — © 2026 Richard Boulais & Claude */
/* =====================================================================
   sw.js — permet de rejouer sans réseau.
   Stratégie : on sert tout de suite la version en cache (démarrage
   instantané, même hors ligne) et on va chercher la version du serveur en
   arrière-plan pour le prochain lancement. Aucun numéro de version à tenir
   à jour : le cache se renouvelle de lui-même à chaque passage en ligne.
   ===================================================================== */
var CACHE = 'rummicard';
var SHELL = [
  './', 'index.html', 'style.css',
  'solver.js', 'engine.js', 'ai.js', 'ui.js',
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
        var frais = fetch(req).then(function (rep) {
          if (rep && rep.ok) cache.put(req, rep.clone());
          return rep;
        }).catch(function () { return cached; });
        return cached || frais;
      });
    })
  );
});
