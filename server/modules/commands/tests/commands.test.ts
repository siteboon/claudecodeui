import assert from 'node:assert/strict';
import { once } from 'node:events';
import * as fs from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
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
): Promise<Record<string, unknown>> {
  const router = createCommandsRouter({
    fileSystem: {
      readFile: async () => JSON.stringify({ name: 'claude-code-ui', version: '0.0.0-test' }),
    } as unknown as typeof import('node:fs/promises'),
    homeDirectory: () => '/home/test',
    appRoot: '/app',
    models: createModelsService(sessionModels) as never,
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

test('models command preserves the Kiro provider and selected model', async () => {
  const result = await executeCommand('/models', { provider: 'kiro', model: 'auto' });
  const data = result.data as { current: { provider: string; model: string }; available: object };
  assert.equal(data.current.provider, 'kiro');
  assert.equal(data.current.model, 'auto');
  assert.deepEqual(Object.keys(data.available), ['kiro']);
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

test('custom commands reject symlink escapes and read the validated canonical target', {
  skip: process.platform === 'win32',
}, async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'command-path-'));
  const commandRoot = path.join(tempRoot, '.claude', 'commands');
  await fs.mkdir(commandRoot, { recursive: true });
  const target = path.join(commandRoot, 'allowed.md');
  const outside = path.join(tempRoot, 'outside.md');
  const allowedLink = path.join(commandRoot, 'allowed-link.md');
  const escapeLink = path.join(commandRoot, 'escape.md');
  await fs.writeFile(target, 'Allowed command');
  await fs.writeFile(outside, 'Private data');
  await fs.symlink(target, allowedLink);
  await fs.symlink(outside, escapeLink);
  const reads: unknown[] = [];
  const router = createCommandsRouter({
    fileSystem: {
      ...fs,
      readFile: async (...args: Parameters<typeof fs.readFile>) => {
        reads.push(args[0]);
        return fs.readFile(...args);
      },
    } as typeof fs,
    homeDirectory: () => tempRoot,
    appRoot: tempRoot,
    models: createModelsService() as never,
    runtime: process,
  });
  const server = express().use(express.json()).use(router).listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const address = server.address() as AddressInfo;
    for (const [commandPath, status] of [[escapeLink, 403], [allowedLink, 200]] as const) {
      const response = await fetch(`http://127.0.0.1:${address.port}/execute`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ commandName: '/custom', commandPath, context: { projectPath: tempRoot } }),
      });
      assert.equal(response.status, status);
      await response.text();
    }
    assert.deepEqual(reads, [await fs.realpath(target)]);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});
