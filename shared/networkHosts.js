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

// Use localhost for connectable loopback and wildcard addresses in browser-facing URLs.
export function getConnectableHost(host) {
  if (!host) {
    return 'localhost';
  }
  return isWildcardHost(host) || isLoopbackHost(host) ? 'localhost' : host;
}

/** True for an IPv6 literal, which a url has to carry in brackets. */
export function isIpv6Host(host) {
  return typeof host === 'string' && host.includes(':') && !host.startsWith('[');
}

/**
 * The address something else can actually connect to, for a machine to use.
 *
 * Unlike `getConnectableHost` this keeps the address family the server bound
 * to. `localhost` covers both and reads nicer, but it is not interchangeable:
 * a client that resolves it to the family the server is not on finds nothing
 * there, and in a browser `localhost` and `127.0.0.1` are separate origins,
 * so anything stored under one is invisible to the other.
 */
export function getBindableHost(host) {
  if (!host || host === 'localhost' || host === '0.0.0.0' || host === '127.0.0.1') {
    return '127.0.0.1';
  }
  if (host === '::' || host === '::1' || host === '[::1]') {
    return '[::1]';
  }
  return isIpv6Host(host) ? `[${host}]` : host;
}
