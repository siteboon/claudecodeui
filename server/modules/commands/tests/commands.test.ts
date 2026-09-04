import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import test from 'node:test';

import express from 'express';

import { createCommandsRouter } from '../commands.routes.js';

/**
 * Stands in for `providerModelsService`. `resolveSessionModel` mirrors the real
 * precedence closely enough for the command handlers: a model recorded for the
 * session wins, otherwise the client's requested model, otherwise the catalog
 * default.
 */
function createModelsService(sessionModels: Record<string, string> = {}) {
  return {
    getProviderModels: async () => ({
      OPTIONS: [{ value: 'default', label: 'Default' }],
      DEFAULT: 'default',
    }),
    getCurrentActiveModel: async () => ({ model: 'default' }),
    setSessionModel: () => null,
    resolveSessionModel: async (
      provider: string,
      options: { sessionId?: string | null; requestedModel?: string | null } = {},
    ) => {
      const recorded = options.sessionId ? sessionModels[options.sessionId] : undefined;
      const model = recorded || options.requestedModel || 'default';
      return {
        provider,
        sessionId: options.sessionId ?? null,
        model,
        source: model === 'default' ? 'default' : 'session',
      };
    },
    resolveResumeModel: async () => undefined,
  };
}

async function executeCommand(
  commandName: string,
  context: Record<string, unknown>,
  sessionModels: Record<string, string> = {},
  tokenUsageOverride?: { getSessionTokenUsage: (id: string) => Promise<unknown> },
): Promise<Record<string, unknown>> {
  const router = createCommandsRouter({
    fileSystem: {
      readFile: async () => JSON.stringify({ name: 'claude-code-ui', version: '0.0.0-test' }),
    } as unknown as typeof import('node:fs/promises'),
    homeDirectory: () => '/home/test',
    appRoot: '/app',
    models: createModelsService(sessionModels) as never,
    tokenUsage: tokenUsageOverride as never,
    runtime: {
      uptime: () => 0,
      memoryUsage: () => ({ rss: 0, heapTotal: 0, heapUsed: 0, external: 0, arrayBuffers: 0 }),
      version: 'v22', platform: 'linux', pid: 1,
    },
  });
  const app = express().use(express.json()).use('/api/commands', router);
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const address = server.address() as AddressInfo;
    const response = await fetch(`http://127.0.0.1:${address.port}/api/commands/execute`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ commandName, context }),
    });
    assert.equal(response.status, 200);
    return await response.json() as Record<string, unknown>;
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

test('models command returns models only for the active provider using injected catalog', async () => {
  const result = await executeCommand('/models', { provider: 'codex' });
  const data = result.data as Record<string, unknown>;
  assert.deepEqual(Object.keys(data.available as object), ['codex']);
});

test('models command falls back to claude for unsupported providers', async () => {
  const result = await executeCommand('/models', { provider: 'unknown-provider' });
  const data = result.data as { current: { provider: string } };
  assert.equal(data.current.provider, 'claude');
});

test('models command reports the model recorded for the session', async () => {
  const result = await executeCommand(
    '/models',
    { provider: 'claude', sessionId: 'session-1', model: 'sonnet' },
    { 'session-1': 'haiku' },
  );

  const data = result.data as { current: { model: string } };
  assert.equal(data.current.model, 'haiku');
});

test('models command reports the composer model for a chat with no session yet', async () => {
  const result = await executeCommand('/models', { provider: 'claude', model: 'haiku' });

  const data = result.data as { current: { model: string } };
  assert.equal(data.current.model, 'haiku');
});

test('cost and status commands report the same resolved model as /models', async () => {
  const context = { provider: 'claude', sessionId: 'session-1', model: 'sonnet' };
  const sessionModels = { 'session-1': 'haiku' };

  const cost = await executeCommand('/cost', context, sessionModels);
  const status = await executeCommand('/status', context, sessionModels);

  assert.equal((cost.data as { model: string }).model, 'haiku');
  assert.equal((status.data as { model: string }).model, 'haiku');
});

test('cost command preserves antigravity provider name', async () => {
  const antigravityCost = await executeCommand('/cost', { provider: 'antigravity' });

  assert.equal((antigravityCost.data as { provider: string }).provider, 'antigravity');
});

test('cost command falls back to injected tokenUsage service when context has no usage', async () => {
  const mockTokenUsage = {
    getSessionTokenUsage: async (sessionId: string) => ({
      used: 4200,
      inputTokens: 3000,
      outputTokens: 1200,
      breakdown: { input: 3000, output: 1200 },
    }),
  };

  const cost = await executeCommand(
    '/cost',
    { provider: 'antigravity', sessionId: 'test-session-123' },
    {},
    mockTokenUsage,
  );

  const data = cost.data as {
    tokenUsage: { used: number };
    tokenBreakdown?: { input: number; output: number };
    provider: string;
  };

  assert.equal(data.provider, 'antigravity');
  assert.equal(data.tokenUsage.used, 4200);
  assert.equal(data.tokenBreakdown?.input, 3000);
  assert.equal(data.tokenBreakdown?.output, 1200);
});

test('cost command supplements a live total with persisted input and output token details', async () => {
  const mockTokenUsage = {
    getSessionTokenUsage: async () => ({
      used: 10_000,
      total: 200_000,
      inputTokens: 7_000,
      outputTokens: 3_000,
      breakdown: { input: 7_000, output: 3_000 },
    }),
  };

  const cost = await executeCommand(
    '/cost',
    {
      provider: 'codex',
      sessionId: 'test-session-123',
      tokenUsage: { used: 10_000, total: 258_400 },
    },
    {},
    mockTokenUsage,
  );

  const data = cost.data as {
    tokenUsage: { used: number; total: number };
    tokenBreakdown?: { input: number; output: number };
  };

  assert.equal(data.tokenUsage.used, 10_000);
  assert.equal(data.tokenUsage.total, 258_400);
  assert.equal(data.tokenBreakdown?.input, 7_000);
  assert.equal(data.tokenBreakdown?.output, 3_000);
});

test('cost command returns immediate session token usage without blocking on quota', async () => {
  const mockTokenUsage = {
    getSessionTokenUsage: async () => ({
      used: 100,
      inputTokens: 80,
      outputTokens: 20,
      breakdown: { input: 80, output: 20 },
    }),
  };

  const cost = await executeCommand(
    '/cost',
    { provider: 'antigravity', sessionId: 'test-session-123' },
    {},
    mockTokenUsage,
  );

  const data = cost.data as {
    provider: string;
    tokenUsage: { used: number };
    tokenBreakdown?: { input: number; output: number };
  };

  assert.equal(data.provider, 'antigravity');
  assert.equal(data.tokenUsage.used, 100);
  assert.equal(data.tokenBreakdown?.input, 80);
  assert.equal(data.tokenBreakdown?.output, 20);
});
