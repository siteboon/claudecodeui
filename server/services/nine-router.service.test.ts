import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  NINE_ROUTER_DEFAULT_PORT,
  check9RouterHealth,
  get9RouterAccounts,
  get9RouterUsage,
} from '@/services/nine-router.service.js';

const patchFetch = (impl: typeof fetch): (() => void) => {
  const original = globalThis.fetch;
  globalThis.fetch = impl;
  return () => {
    globalThis.fetch = original;
  };
};

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const textResponse = (body: string, status = 200): Response =>
  new Response(body, { status });

test('NINE_ROUTER_DEFAULT_PORT is 20128', () => {
  assert.equal(NINE_ROUTER_DEFAULT_PORT, 20128);
});

test('check9RouterHealth returns reachable: true when /api/init responds 200', async () => {
  let calledUrl = '';
  const restore = patchFetch(async (input) => {
    calledUrl = typeof input === 'string' ? input : (input as URL).toString();
    return textResponse('Initialized', 200);
  });
  try {
    const result = await check9RouterHealth();
    assert.equal(result.reachable, true);
    assert.equal(result.port, NINE_ROUTER_DEFAULT_PORT);
    assert.match(calledUrl, /:20128\/api\/init/);
  } finally {
    restore();
  }
});

test('check9RouterHealth returns reachable: false when fetch rejects (connection refused)', async () => {
  const restore = patchFetch(async () => {
    throw new Error('connect ECONNREFUSED 127.0.0.1:20128');
  });
  try {
    const result = await check9RouterHealth();
    assert.equal(result.reachable, false);
    assert.match(result.error ?? '', /ECONNREFUSED/);
  } finally {
    restore();
  }
});

test('check9RouterHealth returns reachable: false on non-2xx response', async () => {
  const restore = patchFetch(async () => textResponse('down', 503));
  try {
    const result = await check9RouterHealth();
    assert.equal(result.reachable, false);
  } finally {
    restore();
  }
});

test('check9RouterHealth respects custom port', async () => {
  let calledUrl = '';
  const restore = patchFetch(async (input) => {
    calledUrl = typeof input === 'string' ? input : (input as URL).toString();
    return textResponse('Initialized', 200);
  });
  try {
    const result = await check9RouterHealth({ port: 9999 });
    assert.equal(result.reachable, true);
    assert.equal(result.port, 9999);
    assert.match(calledUrl, /:9999\/api\/init/);
  } finally {
    restore();
  }
});

test('get9RouterAccounts maps 9Router connections to CloudCLI account shape', async () => {
  let calledUrl = '';
  const restore = patchFetch(async (input) => {
    calledUrl = typeof input === 'string' ? input : (input as URL).toString();
    return jsonResponse({
      connections: [
        {
          id: 'conn-1',
          provider: 'anthropic',
          authType: 'oauth',
          name: 'Avi Primary',
          priority: 1,
          isActive: true,
          testStatus: 'success',
        },
        {
          id: 'conn-2',
          provider: 'anthropic',
          authType: 'oauth',
          name: 'Avi Secondary',
          priority: 2,
          isActive: true,
          testStatus: 'unknown',
        },
      ],
    });
  });
  try {
    const accounts = await get9RouterAccounts();
    assert.match(calledUrl, /:20128\/api\/providers/);
    assert.equal(accounts.length, 2);
    assert.equal(accounts[0].id, 'conn-1');
    assert.equal(accounts[0].provider, 'anthropic');
    assert.equal(accounts[0].name, 'Avi Primary');
    assert.equal(accounts[0].active, true);
    assert.equal(accounts[0].testStatus, 'success');
    assert.equal(accounts[1].id, 'conn-2');
    assert.equal(accounts[1].name, 'Avi Secondary');
  } finally {
    restore();
  }
});

test('get9RouterAccounts returns empty array when 9Router is unreachable', async () => {
  const restore = patchFetch(async () => {
    throw new Error('connect ECONNREFUSED 127.0.0.1:20128');
  });
  try {
    const accounts = await get9RouterAccounts();
    assert.deepEqual(accounts, []);
  } finally {
    restore();
  }
});

test('get9RouterAccounts returns empty array on non-2xx response', async () => {
  const restore = patchFetch(async () => jsonResponse({ error: 'unauthorized' }, 401));
  try {
    const accounts = await get9RouterAccounts();
    assert.deepEqual(accounts, []);
  } finally {
    restore();
  }
});

test('get9RouterAccounts handles missing connections array gracefully', async () => {
  const restore = patchFetch(async () => jsonResponse({}));
  try {
    const accounts = await get9RouterAccounts();
    assert.deepEqual(accounts, []);
  } finally {
    restore();
  }
});

test('get9RouterUsage maps 9Router stats to CloudCLI usage shape', async () => {
  let calledUrl = '';
  const restore = patchFetch(async (input) => {
    calledUrl = typeof input === 'string' ? input : (input as URL).toString();
    return jsonResponse({
      totalRequests: 142,
      totalPromptTokens: 60000,
      totalCompletionTokens: 35800,
      totalCost: 1.27,
      byAccount: {
        'conn-1': { requests: 80, promptTokens: 32000, completionTokens: 18000, cost: 0.65 },
        'conn-2': { requests: 62, promptTokens: 28000, completionTokens: 17800, cost: 0.62 },
      },
    });
  });
  try {
    const usage = await get9RouterUsage();
    assert.match(calledUrl, /:20128\/api\/usage\/stats/);
    assert.equal(usage.totalRequests, 142);
    assert.equal(usage.totalTokens, 95800);
    assert.equal(usage.totalCostUsd, 1.27);
    assert.equal(usage.perAccount['conn-1']?.requests, 80);
    assert.equal(usage.perAccount['conn-1']?.tokens, 50000);
    assert.equal(usage.perAccount['conn-1']?.costUsd, 0.65);
    assert.equal(usage.perAccount['conn-2']?.tokens, 45800);
  } finally {
    restore();
  }
});

test('get9RouterUsage passes period query parameter', async () => {
  let calledUrl = '';
  const restore = patchFetch(async (input) => {
    calledUrl = typeof input === 'string' ? input : (input as URL).toString();
    return jsonResponse({
      totalRequests: 0,
      totalPromptTokens: 0,
      totalCompletionTokens: 0,
      totalCost: 0,
      byAccount: {},
    });
  });
  try {
    await get9RouterUsage({ period: '24h' });
    assert.match(calledUrl, /period=24h/);
  } finally {
    restore();
  }
});

test('get9RouterUsage returns zeroed defaults when 9Router is unreachable', async () => {
  const restore = patchFetch(async () => {
    throw new Error('connect ECONNREFUSED 127.0.0.1:20128');
  });
  try {
    const usage = await get9RouterUsage();
    assert.equal(usage.totalRequests, 0);
    assert.equal(usage.totalTokens, 0);
    assert.equal(usage.totalCostUsd, 0);
    assert.deepEqual(usage.perAccount, {});
  } finally {
    restore();
  }
});

test('get9RouterUsage handles missing byAccount field gracefully', async () => {
  const restore = patchFetch(async () =>
    jsonResponse({
      totalRequests: 5,
      totalPromptTokens: 800,
      totalCompletionTokens: 200,
      totalCost: 0.01,
    }),
  );
  try {
    const usage = await get9RouterUsage();
    assert.equal(usage.totalRequests, 5);
    assert.equal(usage.totalTokens, 1000);
    assert.deepEqual(usage.perAccount, {});
  } finally {
    restore();
  }
});
