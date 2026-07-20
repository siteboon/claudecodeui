import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import test from 'node:test';

import express from 'express';

import { createCommandsRouter } from '../commands.routes.js';

async function executeModels(provider: string): Promise<Record<string, unknown>> {
  const router = createCommandsRouter({
    fileSystem: {} as typeof import('node:fs/promises'),
    homeDirectory: () => '/home/test',
    appRoot: '/app',
    models: {
      getProviderModels: async () => ({
        models: { OPTIONS: [{ value: 'default', label: 'Default' }], DEFAULT: 'default' },
        cache: {
          updatedAt: '2026-01-01T00:00:00.000Z',
          expiresAt: '2026-01-02T00:00:00.000Z',
          source: 'fresh',
        },
      }),
      getCurrentActiveModel: async () => ({ model: 'default' }),
      changeActiveModel: async () => ({
        provider: 'claude', sessionId: 'session-1', supported: true, changed: true, model: 'default',
      }),
      getChangedActiveModel: async () => ({
        provider: 'claude', sessionId: 'session-1', supported: true, changed: false, model: null,
      }),
      resolveResumeModel: async () => undefined,
      clearCache: () => undefined,
    },
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
      body: JSON.stringify({ commandName: '/models', context: { provider } }),
    });
    assert.equal(response.status, 200);
    return await response.json() as Record<string, unknown>;
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

test('models command returns models only for the active provider using injected catalog', async () => {
  const result = await executeModels('codex');
  const data = result.data as Record<string, unknown>;
  assert.deepEqual(Object.keys(data.available as object), ['codex']);
});

test('models command falls back to claude for unsupported providers', async () => {
  const result = await executeModels('unknown-provider');
  const data = result.data as { current: { provider: string } };
  assert.equal(data.current.provider, 'claude');
});
