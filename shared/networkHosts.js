export function isWildcardHost(host) {
  return host === '0.0.0.0' || host === '::';
}

export function isLoopbackHost(host) {
  return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]';
}

export function normalizeLoopbackHost(host) {
  if (!host) {
    return host;
  }
  return isLoopbackHost(host) ? 'localhost' : host;
}

// Address that server/index.ts listens on for a HOST setting. vite.config.js uses it for its proxy
// and browser URLs, and listens on getViteListenHost() instead.
// Unset or empty returns undefined so the caller leaves the host out: Node then listens on `::`
// with IPV6_V6ONLY off, which accepts IPv4 and IPv6 on every interface, and falls back to 0.0.0.0
// on machines without IPv6. Explicit values are returned unchanged, so HOST=0.0.0.0 stays
// IPv4-only and HOST=127.0.0.1 or ::1 stays loopback-only.
export function getListenHost(host) {
  return host || undefined;
}

// Vite `server.host` that vite.config.js uses for a HOST setting. Unset or empty returns `true`,
// which makes Vite leave the host out of listen() too, so it gets the same IPv4 + IPv6 default and
// IPv4 fallback as the backend; an explicit '::' would fail to listen on machines without IPv6.
// Loopback addresses become 'localhost'; any other value is returned unchanged.
export function getViteListenHost(host) {
  const listenHost = getListenHost(host);
  return listenHost === undefined ? true : normalizeLoopbackHost(listenHost);
}

// Use localhost for connectable loopback and wildcard addresses in browser-facing URLs.
export function getConnectableHost(host) {
  if (!host) {
    return 'localhost';
  }
  return isWildcardHost(host) || isLoopbackHost(host) ? 'localhost' : host;
}
