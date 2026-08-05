// rate-limit middleware exposes a single factory that the auth router mounts
// on the login and register endpoints. Keeping the failure path explicit (no
// shared store) so the limit applies per-process without coupling to the
// persistence layer.
import type { Request, RequestHandler, Response } from 'express';

type RateLimiterOptions = {
  /** Maximum number of attempts allowed within the rolling window. */
  maxAttempts: number;
  /** Length of the rolling window, in milliseconds. */
  windowMs: number;
  /** How long a locked-out client should be told to wait before retrying. */
  lockoutMs?: number;
  /** Optional clock for tests. */
  now?: () => number;
};

type AttemptRecord = {
  /** Timestamps (ms) of attempts that fall inside the rolling window. */
  timestamps: number[];
  /** Earliest time at which the client may try again after a lockout. */
  blockedUntil: number;
};

function readClientKey(req: Request): string {
  // Prefer the address of the TCP peer; fall back to a header chain that
  // includes the most common reverse-proxy forwarded-for conventions.
  const socketAddress = req.socket?.remoteAddress;
  if (socketAddress && socketAddress !== '::1' && socketAddress !== '127.0.0.1') {
    return socketAddress;
  }

  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0]!.trim();
  }
  if (Array.isArray(forwarded) && forwarded.length > 0) {
    return forwarded[0]!.split(',')[0]!.trim();
  }

  return socketAddress || 'unknown';
}

/**
 * Builds a per-key sliding-window rate limiter suitable for protecting the
 * login and registration endpoints against credential-stuffing attempts.
 *
 * The limiter keeps an in-memory `Map` of client-key → attempt history. Each
 * incoming request drops expired timestamps from the history; if the count
 * after dropping exceeds `maxAttempts`, the request is rejected with HTTP
 * 429 until enough time has elapsed for at least one slot to expire.
 */
export function createRateLimiter(options: RateLimiterOptions): {
  middleware: RequestHandler;
  reset: () => void;
} {
  const maxAttempts = options.maxAttempts;
  const windowMs = options.windowMs;
  const lockoutMs = options.lockoutMs ?? windowMs;
  const clock = options.now ?? (() => Date.now());

  const records = new Map<string, AttemptRecord>();

  const middleware: RequestHandler = (req: Request, res: Response, next) => {
    const clientKey = readClientKey(req);
    const now = clock();
    let record = records.get(clientKey);
    if (!record) {
      record = { timestamps: [], blockedUntil: 0 };
      records.set(clientKey, record);
    }

    // An active lockout short-circuits the limiter; do not consume an attempt
    // slot so a misbehaving client cannot extend the lockout indefinitely.
    if (record.blockedUntil > now) {
      const retryAfterSeconds = Math.max(1, Math.ceil((record.blockedUntil - now) / 1000));
      res.setHeader('Retry-After', String(retryAfterSeconds));
      res.status(429).json({
        success: false,
        error: {
          code: 'RATE_LIMITED',
          message: 'Too many attempts. Please try again later.',
          retryAfterSeconds,
        },
      });
      return;
    }

    // Drop timestamps that have aged out of the rolling window.
    const cutoff = now - windowMs;
    record.timestamps = record.timestamps.filter((timestamp) => timestamp > cutoff);

    if (record.timestamps.length >= maxAttempts) {
      // `lockoutMs` is the minimum backoff, but `Retry-After` must reflect
      // the *next* time a request can succeed — i.e. when at least one of
      // the retained timestamps ages out of the rolling window. If the
      // operator configured `lockoutMs < windowMs`, the rolling window
      // outlives the lockout, so blocking for only `lockoutMs` would let a
      // client come back and immediately trigger another lockout despite the
      // previous response telling it to wait.
      const earliestExpiry = record.timestamps.length > 0
        ? record.timestamps[0]! + windowMs
        : now + windowMs;
      const nextAvailableAt = Math.max(now + lockoutMs, earliestExpiry);
      record.blockedUntil = nextAvailableAt;
      const retryAfterSeconds = Math.max(1, Math.ceil((nextAvailableAt - now) / 1000));
      res.setHeader('Retry-After', String(retryAfterSeconds));
      res.status(429).json({
        success: false,
        error: {
          code: 'RATE_LIMITED',
          message: 'Too many attempts. Please try again later.',
          retryAfterSeconds,
        },
      });
      return;
    }

    record.timestamps.push(now);
    next();
  };

  return {
    middleware,
    reset: () => records.clear(),
  };
}
