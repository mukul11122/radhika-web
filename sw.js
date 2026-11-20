'use strict';
const CACHE = 'radhika-offline-v1';
const OFFLINE = '/offline.html';
// Only the offline screen is stored. Inventory, logins and uploads stay online.
self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.add(OFFLINE)));
});
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k.startsWith('radhika-offline-') && k !== CACHE)
            .map((k) => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
  );
});
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET' || event.request.mode !== 'navigate') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  event.respondWith(
    fetch(event.request).catch(() =>
      caches.match(OFFLINE).then(
        (response) =>
          response ||
          new Response('You are offline. Reconnect to use Radhika Agencies.', {
            status: 503,
            headers: { 'Content-Type': 'text/plain' },
          })
      )
    )
  );
});
