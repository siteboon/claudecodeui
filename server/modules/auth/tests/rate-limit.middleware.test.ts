import assert from 'node:assert/strict';
import test from 'node:test';

import { createRateLimiter } from '../rate-limit.middleware.js';

function createMockResponse(): {
  statusCode: number;
  body: unknown;
  headers: Record<string, string>;
  status(code: number): typeof response;
  setHeader(name: string, value: string): void;
  json(body: unknown): typeof response;
} {
  const response = {
    statusCode: 200,
    body: undefined as unknown,
    headers: {} as Record<string, string>,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    setHeader(name: string, value: string) {
      this.headers[name] = value;
    },
    json(body: unknown) {
      this.body = body;
      return this;
    },
  };
  return response;
}

function createMockRequest(clientKey: string): {
  socket?: { remoteAddress?: string };
  headers: Record<string, string>;
} {
  return {
    socket: { remoteAddress: clientKey },
    headers: {},
  };
}

test('requests below the attempt cap pass through', () => {
  const limiter = createRateLimiter({ maxAttempts: 3, windowMs: 1000, now: () => 1000 });
  const next = (() => { calls.push(1); }) as () => void;
  const calls: number[] = [];

  for (let i = 0; i < 3; i += 1) {
    limiter.middleware(createMockRequest('203.0.113.1') as never, createMockResponse() as never, next);
  }

  assert.equal(calls.length, 3);
});

test('the request that trips the limit is rejected with 429 + Retry-After', () => {
  let currentTime = 1000;
  const limiter = createRateLimiter({
    maxAttempts: 2,
    windowMs: 1000,
    lockoutMs: 5000,
    now: () => currentTime,
  });
  const next = () => undefined;
  const blocked: { status: number; body: unknown; headers: Record<string, string> } = {
    status: 200,
    body: undefined,
    headers: {},
  };
  const response = {
    statusCode: 0,
    body: undefined as unknown,
    headers: {} as Record<string, string>,
    status(code: number) { this.statusCode = code; return this; },
    setHeader(name: string, value: string) { this.headers[name] = value; },
    json(body: unknown) { this.body = body; return this; },
  };

  // Two successful requests.
  limiter.middleware(createMockRequest('203.0.113.2') as never, response as never, next);
  limiter.middleware(createMockRequest('203.0.113.2') as never, response as never, next);

  // Third request trips the limiter.
  limiter.middleware(createMockRequest('203.0.113.2') as never, response as never, next);

  assert.equal(response.statusCode, 429);
  assert.equal(response.headers['Retry-After'], '5');
  assert.ok(response.body && typeof response.body === 'object');
  assert.equal((response.body as { success: boolean }).success, false);
});

test('lockout does not extend when the client keeps hammering', () => {
  let currentTime = 1000;
  const limiter = createRateLimiter({
    maxAttempts: 1,
    windowMs: 1000,
    lockoutMs: 2000,
    now: () => currentTime,
  });
  const next = () => undefined;
  const response = {
    statusCode: 0,
    body: undefined as unknown,
    headers: {} as Record<string, string>,
    status(code: number) { this.statusCode = code; return this; },
    setHeader(name: string, value: string) { this.headers[name] = value; },
    json(body: unknown) { this.body = body; return this; },
  };

  // First request consumes the only slot.
  limiter.middleware(createMockRequest('203.0.113.3') as never, response as never, next);
  // Next request trips the limit and starts a lockout.
  limiter.middleware(createMockRequest('203.0.113.3') as never, response as never, next);
  const firstBlockEnd = response.headers['Retry-After'];

  // Advance simulated time by 1100 ms. The original lockout expires at
  // `now + lockoutMs` = 1000 + 2000 = 3000, so 2100 ms is still inside it.
  // The rolling-window timestamp at 1000 expires at 1000 + 1000 = 2000, so
  // 2100 ms is 100 ms past that expiry. A preserved lockout therefore
  // returns the remaining `Retry-After` duration; a reset lockout would
  // also return the same number. Advance far enough that the next request
  // would only succeed if the lockout was preserved — the next call sits
  // at `now = 2100`, so the preserved lockout returns 1 (`3000 - 2100`).
  currentTime += 1100;
  limiter.middleware(createMockRequest('203.0.113.3') as never, response as never, next);

  assert.equal(firstBlockEnd, '2');
  assert.equal(response.statusCode, 429);
  assert.equal(response.headers['Retry-After'], '1');
});

test('Retry-After reflects the rolling window when it outlives lockoutMs', () => {
  let currentTime = 1000;
  const limiter = createRateLimiter({
    maxAttempts: 1,
    windowMs: 5000,
    lockoutMs: 1000,
    now: () => currentTime,
  });
  const next = () => undefined;
  const response = {
    statusCode: 0,
    body: undefined as unknown,
    headers: {} as Record<string, string>,
    status(code: number) { this.statusCode = code; return this; },
    setHeader(name: string, value: string) { this.headers[name] = value; },
    json(body: unknown) { this.body = body; return this; },
  };

  // Consume the only slot and trip the limit.
  limiter.middleware(createMockRequest('203.0.113.7') as never, response as never, next);
  limiter.middleware(createMockRequest('203.0.113.7') as never, response as never, next);

  // `Retry-After` must be the larger of `lockoutMs` and the time until the
  // earliest retained timestamp ages out — here the rolling window (5 s)
  // outlives `lockoutMs` (1 s), so the client must wait 5 s.
  assert.equal(response.headers['Retry-After'], '5');
});

test('rolling window lets the client through once old attempts age out', () => {
  let currentTime = 1000;
  const limiter = createRateLimiter({
    maxAttempts: 2,
    windowMs: 1000,
    now: () => currentTime,
  });
  const next = (() => { calls.push(1); }) as () => void;
  const calls: number[] = [];
  const response = {
    statusCode: 0,
    body: undefined as unknown,
    headers: {} as Record<string, string>,
    status(code: number) { this.statusCode = code; return this; },
    setHeader(name: string, value: string) { this.headers[name] = value; },
    json(body: unknown) { this.body = body; return this; },
  };

  limiter.middleware(createMockRequest('203.0.113.4') as never, response as never, next);
  limiter.middleware(createMockRequest('203.0.113.4') as never, response as never, next);
  limiter.middleware(createMockRequest('203.0.113.4') as never, response as never, next);
  assert.equal(calls.length, 2);

  // Advance past the window so the earlier timestamps drop off.
  currentTime += 1100;
  limiter.middleware(createMockRequest('203.0.113.4') as never, response as never, next);
  assert.equal(calls.length, 3);
});

test('different client keys are tracked independently', () => {
  const limiter = createRateLimiter({ maxAttempts: 1, windowMs: 1000, now: () => 1000 });
  const next = (() => { calls.push(1); }) as () => void;
  const calls: number[] = [];
  const response = {
    statusCode: 0,
    body: undefined as unknown,
    headers: {} as Record<string, string>,
    status(code: number) { this.statusCode = code; return this; },
    setHeader(name: string, value: string) { this.headers[name] = value; },
    json(body: unknown) { this.body = body; return this; },
  };

  limiter.middleware(createMockRequest('203.0.113.5') as never, response as never, next);
  limiter.middleware(createMockRequest('203.0.113.6') as never, response as never, next);

  assert.equal(calls.length, 2);
});
