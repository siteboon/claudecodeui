// Service Worker for Claude Code UI PWA
// Supports both direct access and orchestrator proxy access via proxyBase parameter

const CACHE_NAME = "claude-ui-v1";

// Extract proxyBase from the service worker URL query string
// e.g., sw.js?proxyBase=/clients/badal-laptop/proxy
const swUrl = new URL(self.location.href);
const proxyBase = swUrl.searchParams.get("proxyBase") || "";

// URLs to cache (root-relative, without proxyBase)
const urlsToCache = ["/", "/index.html", "/manifest.json"];

// Normalize a URL by removing the proxyBase prefix if present
// This allows us to use consistent cache keys regardless of access path
function normalizeUrl(url) {
  if (!proxyBase) return url;

  try {
    const urlObj = new URL(url);
    let pathname = urlObj.pathname;

    // Remove proxyBase prefix if present
    if (pathname.startsWith(proxyBase)) {
      pathname = pathname.slice(proxyBase.length) || "/";
    }

    return pathname + urlObj.search;
  } catch {
    // If URL parsing fails, try string manipulation
    if (url.startsWith(proxyBase)) {
      return url.slice(proxyBase.length) || "/";
    }
    return url;
  }
}

// Add proxyBase prefix to a root-relative URL
function denormalizeUrl(url) {
  if (!proxyBase) return url;
  if (url.startsWith("/")) {
    return proxyBase + url;
  }
  return url;
}

// Install event
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      // Cache URLs with proxyBase prefix if needed
      const urlsWithBase = urlsToCache.map((url) => denormalizeUrl(url));
      return cache.addAll(urlsWithBase);
    }),
  );
  self.skipWaiting();
});

// Fetch event
self.addEventListener("fetch", (event) => {
  event.respondWith(
    (async () => {
      const request = event.request;
      const normalizedUrl = normalizeUrl(request.url);

      // Try to find a cached response using the normalized URL
      const cache = await caches.open(CACHE_NAME);

      // First try exact match
      let response = await cache.match(request);

      // If no exact match and we have a proxyBase, try matching with/without it
      if (!response && proxyBase) {
        // Try the denormalized version (with proxyBase)
        const denormalizedUrl = denormalizeUrl(normalizedUrl);
        response = await cache.match(new Request(denormalizedUrl));

        // Also try the normalized version (without proxyBase)
        if (!response) {
          response = await cache.match(new Request(normalizedUrl));
        }
      }

      if (response) {
        return response;
      }

      // Otherwise fetch from network
      return fetch(request);
    })(),
  );
});

// Activate event
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        }),
      );
    }),
  );
});
