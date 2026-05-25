// Service worker removed alongside auth/push. This stub deregisters itself
// the moment it activates so legacy installs stop intercepting fetches.
self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
      await self.registration.unregister();
      const clients = await self.clients.matchAll();
      for (const client of clients) {
        if (typeof client.navigate === 'function') {
          client.navigate(client.url);
        }
      }
    })(),
  );
});
