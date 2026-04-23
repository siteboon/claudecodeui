// Service Worker for CloudCLI PWA
// Cache only manifest (needed for PWA install). HTML and JS are never pre-cached
// so a rebuild + refresh always picks up the latest assets.
const CACHE_NAME = 'claude-ui-v2';

// Derive base path from service worker's own location.
// If SW is at /s/mealstead/sw.js, BASE_PATH = '/s/mealstead'.
// If SW is at /sw.js, BASE_PATH = ''.
const SW_PATH = self.location.pathname;
const BASE_PATH = SW_PATH.substring(0, SW_PATH.lastIndexOf('/')) || '';

const urlsToCache = [
  `${BASE_PATH}/manifest.json`
];

// Install event
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(urlsToCache))
  );
  self.skipWaiting();
});

// Fetch event — only intercept assets and navigation, let everything else pass through
self.addEventListener('fetch', event => {
  const url = event.request.url;

  // Only intercept same-origin requests
  if (!url.startsWith(self.location.origin)) return;

  // Hashed assets (JS/CSS in /assets/) — cache-first since filenames change per build
  if (url.includes(`${BASE_PATH}/assets/`)) {
    event.respondWith(
      caches.match(event.request).then(cached => {
        if (cached) return cached;
        return fetch(event.request).then(response => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          return response;
        });
      })
    );
    return;
  }

  // Navigation requests (HTML) — always go to network, offline fallback
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(() =>
        new Response('<h1>Offline</h1><p>Please check your connection.</p>', {
          headers: { 'Content-Type': 'text/html' }
        })
      )
    );
    return;
  }

  // Everything else (API, WS, session routes, etc.) — don't intercept
});

// Activate event — purge old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames =>
      Promise.all(
        cacheNames
          .filter(name => name !== CACHE_NAME)
          .map(name => caches.delete(name))
      )
    )
  );
  self.clients.claim();
});

// Push notification event
self.addEventListener('push', event => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch {
    payload = { title: 'CloudCLI', body: event.data.text() };
  }

  const options = {
    body: payload.body || '',
    icon: `${BASE_PATH}/logo-256.png`,
    badge: `${BASE_PATH}/logo-128.png`,
    data: payload.data || {},
    tag: payload.data?.tag || `${payload.data?.sessionId || 'global'}:${payload.data?.code || 'default'}`,
    renotify: true
  };

  event.waitUntil(
    self.registration.showNotification(payload.title || 'CloudCLI', options)
  );
});

// Notification click event
self.addEventListener('notificationclick', event => {
  event.notification.close();

  const sessionId = event.notification.data?.sessionId;
  const provider = event.notification.data?.provider || null;
  const urlPath = sessionId ? `${BASE_PATH}/session/${sessionId}` : `${BASE_PATH}/`;

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async clientList => {
      for (const client of clientList) {
        if (client.url.includes(self.location.origin)) {
          await client.focus();
          client.postMessage({
            type: 'notification:navigate',
            sessionId: sessionId || null,
            provider,
            urlPath
          });
          return;
        }
      }
      return self.clients.openWindow(urlPath);
    })
  );
});
