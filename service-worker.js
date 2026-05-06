// Cache-first service worker with version-bumped cache name (AF10).
// Bump CACHE_NAME on every release to force a fresh fetch of the app shell.
const CACHE_NAME = 'rotation-planner-2026-05-05-p3-fix25';

const APP_SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/app.css',
  './js/app.js',
  './js/store.js',
  './js/id.js',
  './js/positions.js',
  './js/rules.js',
  './js/generate.js',
  './js/edit.js',
  './js/rebalance.js',
  './js/ui/bottom-sheet.js',
  './js/ui/toast.js',
  './js/ui/tab-players.js',
  './js/ui/tab-game.js',
  './js/ui/tab-game-summary.js',
  './js/ui/tab-saved.js',
  './js/ui/tab-settings.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n))
      );
      await self.clients.claim();
      const clients = await self.clients.matchAll({ includeUncontrolled: true });
      clients.forEach((client) => {
        client.postMessage({ type: 'NEW_VERSION', cache: CACHE_NAME });
      });
    })()
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).catch(() => caches.match('./index.html'));
    })
  );
});
