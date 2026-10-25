import net from 'node:net';

import type { NextFunction, Request, RequestHandler, Response } from 'express';

/**
 * Remote access guard. Remote access is opt-in (`WORKBENCH_REMOTE=1`); even then only loopback
 * and Tailscale addresses may connect. Everything else (LAN, internet) is dropped at the TCP
 * level, before any HTTP or WebSocket handling.
 */
export function isRemoteEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.WORKBENCH_REMOTE === '1';
}

/** Strips the IPv4-mapped IPv6 prefix (`::ffff:100.64.0.1`) and any zone id. */
export function normalizeAddress(address: string | undefined | null): string {
  if (!address) return '';
  const withoutZone = address.split('%')[0];
  return withoutZone.toLowerCase().startsWith('::ffff:') ? withoutZone.slice(7) : withoutZone;
}

export function isLoopbackAddress(address: string | undefined | null): boolean {
  const normalized = normalizeAddress(address);
  if (normalized === '::1') return true;
  return net.isIPv4(normalized) && normalized.startsWith('127.');
}

/** Tailscale: IPv4 100.64.0.0/10 (CGNAT) and IPv6 fd7a:115c:a1e0::/48. */
export function isTailscaleAddress(address: string | undefined | null): boolean {
  const normalized = normalizeAddress(address);
  if (net.isIPv4(normalized)) {
    const [a, b] = normalized.split('.').map(Number);
    return a === 100 && b >= 64 && b <= 127;
  }
  return normalized.startsWith('fd7a:115c:a1e0:');
}

export function isAllowedAddress(address: string | undefined | null, remoteEnabled = isRemoteEnabled()): boolean {
  if (isLoopbackAddress(address)) return true;
  return remoteEnabled && isTailscaleAddress(address);
}

/** TCP-level gate for an `http.Server` (covers HTTP and WebSocket upgrades). */
export function attachConnectionGuard(
  server: { on(event: 'connection', listener: (socket: net.Socket) => void): unknown },
  remoteEnabled = isRemoteEnabled(),
): void {
  server.on('connection', (socket) => {
    if (!isAllowedAddress(socket.remoteAddress, remoteEnabled)) {
      socket.destroy();
    }
  });
}

/** Account creation (first-run setup) is only allowed from the PC itself. */
export const registerFromLoopbackOnly: RequestHandler = (req: Request, res: Response, next: NextFunction) => {
  if (!isLoopbackAddress(req.socket.remoteAddress)) {
    res.status(403).json({ error: 'Create the account on the PC first; remote setup is disabled.' });
    return;
  }
  next();
};

type Attempts = { failures: number[]; };

/**
 * In-memory login throttle: `perIpLimit` failed logins per IP and `globalLimit` across all IPs
 * within `windowMs` return 429. A successful login clears that IP's counter.
 */
export function createLoginRateLimiter(options: {
  windowMs?: number;
  perIpLimit?: number;
  globalLimit?: number;
  now?: () => number;
} = {}): RequestHandler {
  const windowMs = options.windowMs ?? 15 * 60_000;
  const perIpLimit = options.perIpLimit ?? 5;
  const globalLimit = options.globalLimit ?? 30;
  const now = options.now ?? Date.now;
  const byIp = new Map<string, Attempts>();
  let global: number[] = [];

  const prune = (list: number[], at: number) => list.filter((time) => at - time < windowMs);

  return (req, res, next) => {
    const at = now();
    const ip = normalizeAddress(req.socket.remoteAddress) || 'unknown';
    const entry = byIp.get(ip) ?? { failures: [] };
    entry.failures = prune(entry.failures, at);
    global = prune(global, at);
    byIp.set(ip, entry);

    if (entry.failures.length >= perIpLimit || global.length >= globalLimit) {
      const oldest = entry.failures.length >= perIpLimit ? entry.failures[0] : global[0];
      res.setHeader('Retry-After', String(Math.max(1, Math.ceil((oldest + windowMs - at) / 1000))));
      res.status(429).json({ error: 'Too many failed login attempts. Try again later.' });
      return;
    }

    res.on('finish', () => {
      const finishedAt = now();
      if (res.statusCode === 401) {
        entry.failures.push(finishedAt);
        global.push(finishedAt);
      } else if (res.statusCode >= 200 && res.statusCode < 300) {
        entry.failures = [];
      }
    });
    next();
  };
}
