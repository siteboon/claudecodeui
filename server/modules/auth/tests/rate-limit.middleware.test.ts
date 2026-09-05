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

test('X-Forwarded-For is honoured only when the TCP peer is a trusted proxy', () => {
  let currentTime = 1000;
  const limiter = createRateLimiter({
    maxAttempts: 1,
    windowMs: 1000,
    now: () => currentTime,
    trustedProxyAddresses: ['10.0.0.1'],
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

  // Trusted proxy → forwarded address is the client key.
  const reqFromProxiedVictim = {
    socket: { remoteAddress: '10.0.0.1' },
    headers: { 'x-forwarded-for': '198.51.100.7' },
  };
  // Untrusted peer claiming to be a victim via X-Forwarded-For → ignored,
  // the TCP peer is the client key.
  const reqFromSpoofer = {
    socket: { remoteAddress: '203.0.113.99' },
    headers: { 'x-forwarded-for': '198.51.100.8' },
  };

  // Each unique forwarded address gets its own slot, so two calls succeed.
  limiter.middleware(reqFromProxiedVictim as never, response as never, next);
  limiter.middleware(reqFromSpoofer as never, response as never, next);
  assert.equal(calls.length, 2);

  // Replay the proxied victim → that key is now exhausted; the spoofer
  // key is exhausted separately. The spoofer cannot bypass by reusing the
  // same TCP peer.
  limiter.middleware(reqFromProxiedVictim as never, response as never, next);
  limiter.middleware(reqFromSpoofer as never, response as never, next);
  assert.equal(calls.length, 2);
  assert.equal(response.statusCode, 429);

  // A different proxied victim starts fresh because the key comes from the
  // header, not the proxy.
  const reqFromProxiedVictim2 = {
    socket: { remoteAddress: '10.0.0.1' },
    headers: { 'x-forwarded-for': '198.51.100.9' },
  };
  limiter.middleware(reqFromProxiedVictim2 as never, response as never, next);
  assert.equal(calls.length, 3);
});

test('untrusted loopback peers cannot spoof X-Forwarded-For', () => {
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

  // No trustedProxyAddresses → loopback peer with X-Forwarded-For must be
  // bucketed under the TCP peer, not the spoofed forwarded address.
  const reqA = {
    socket: { remoteAddress: '127.0.0.1' },
    headers: { 'x-forwarded-for': '198.51.100.10' },
  };
  const reqB = {
    socket: { remoteAddress: '127.0.0.1' },
    headers: { 'x-forwarded-for': '198.51.100.11' },
  };
  limiter.middleware(reqA as never, response as never, next);
  limiter.middleware(reqB as never, response as never, next);
  // Both calls share the TCP peer bucket, so the second is rate-limited.
  assert.equal(calls.length, 1);
  assert.equal(response.statusCode, 429);
});

test('records map is bounded by expiring entries after the window passes', () => {
  let currentTime = 1000;
  const limiter = createRateLimiter({ maxAttempts: 1, windowMs: 1000, now: () => currentTime });
  const next = () => undefined;
  const response = {
    statusCode: 0,
    body: undefined as unknown,
    headers: {} as Record<string, string>,
    status(code: number) { this.statusCode = code; return this; },
    setHeader(name: string, value: string) { this.headers[name] = value; },
    json(body: unknown) { this.body = body; return this; },
  };

  // Push 50 distinct addresses through the limiter.
  for (let i = 0; i < 50; i += 1) {
    limiter.middleware(createMockRequest(`198.51.100.${i}`) as never, response as never, next);
  }
  assert.equal(limiter.size(), 50);

  // Advance well past the window so all timestamps age out, then a single
  // request triggers the periodic sweep.
  currentTime += 5000;
  limiter.middleware(createMockRequest('198.51.100.0') as never, response as never, next);
  // Only the just-touched record remains; the other 49 were evicted.
  assert.equal(limiter.size(), 1);
});

test('trusted proxy chain selects the nearest untrusted client address', () => {
  let currentTime = 1000;
  const limiter = createRateLimiter({
    maxAttempts: 1,
    windowMs: 1000,
    now: () => currentTime,
    trustedProxyAddresses: ['10.0.0.1', '10.0.0.2'],
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

  // Real client "198.51.100.7" sits behind two trusted proxies
  // (10.0.0.1 → 10.0.0.2). The trusted outer proxy appends the inner
  // trusted proxy (10.0.0.1) on the right, which itself appended the real
  // client address. An attacker forged the leftmost value. The parser
  // must walk right-to-left, skip 10.0.0.2 (TCP peer / trusted), skip
  // 10.0.0.1 (configured trusted hop), and stop at 198.51.100.7.
  const realClientRequest = {
    socket: { remoteAddress: '10.0.0.2' },
    headers: { 'x-forwarded-for': '198.51.100.99, 10.0.0.1, 198.51.100.7' },
  };
  limiter.middleware(realClientRequest as never, response as never, next);
  assert.equal(calls.length, 1);

  // A spoofed request that tries to reuse the same forged value with no
  // real client behind it: the spoofed "198.51.100.99" is treated as its
  // own key (after the legitimate 198.51.100.7 consumed its slot). The
  // attacker cannot land in the real client's bucket because the parser
  // walks the chain from right to left and stops at the first non-proxy
  // hop (198.51.100.7), not the attacker-supplied leftmost value.
  const spoofRequest = {
    socket: { remoteAddress: '10.0.0.2' },
    headers: { 'x-forwarded-for': '198.51.100.99' },
  };
  limiter.middleware(spoofRequest as never, response as never, next);
  assert.equal(calls.length, 2);
});

test('trusted proxy chain with only trusted hops falls back to TCP peer', () => {
  const limiter = createRateLimiter({
    maxAttempts: 1,
    windowMs: 1000,
    now: () => 1000,
    trustedProxyAddresses: ['10.0.0.1', '10.0.0.2', '10.0.0.3'],
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

  // Header contains only trusted hops — parser walks right-to-left, every
  // entry is trusted, so the function falls back to the TCP peer. The
  // attacker cannot force the limiter into a different bucket by chaining
  // trusted addresses.
  const requestWithHeader = {
    socket: { remoteAddress: '10.0.0.2' },
    headers: { 'x-forwarded-for': '10.0.0.1, 10.0.0.3, 10.0.0.2' },
  };
  limiter.middleware(requestWithHeader as never, response as never, next);
  assert.equal(calls.length, 1);

  // Second request arrives from the same TCP peer but without the header.
  // It must be bucketed under the same key (the TCP peer fallback) and
  // rejected with 429, proving the fallback path is observable.
  const requestWithoutHeader = {
    socket: { remoteAddress: '10.0.0.2' },
    headers: {},
  };
  limiter.middleware(requestWithoutHeader as never, response as never, next);
  assert.equal(calls.length, 1);
  assert.equal(response.statusCode, 429);
});
