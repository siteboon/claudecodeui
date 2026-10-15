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

const CUSTOM_COMMAND_PATH = '/home/test/.claude/commands/echo.md';

/**
 * Runs a custom command whose file holds `template`, posting `body` the way
 * the composer does. The custom-command branch reads the file through the
 * injected filesystem, so no real `.claude/commands` directory is needed.
 */
async function executeCustomCommand(
  template: string,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const router = createCommandsRouter({
    fileSystem: {
      readFile: async (filePath: string) => {
        assert.equal(filePath, CUSTOM_COMMAND_PATH);
        return template;
      },
    } as unknown as typeof import('node:fs/promises'),
    homeDirectory: () => '/home/test',
    appRoot: '/app',
    models: createModelsService() as never,
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
      body: JSON.stringify({ commandName: '/echo', commandPath: CUSTOM_COMMAND_PATH, context: {}, ...body }),
    });
    assert.equal(response.status, 200);
    return await response.json() as Record<string, unknown>;
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

// #1523: a multi-line brief typed after a custom command reached $ARGUMENTS as
// its first line only, with the remaining whitespace collapsed.
test('custom command $ARGUMENTS receives the raw argument text with line breaks and spacing kept', async () => {
  const rawArgs = 'first line\nsecond line\n  indented   third';
  const result = await executeCustomCommand('Repeat back exactly what follows:\n\n$ARGUMENTS\n', {
    args: rawArgs.split(/\s+/).filter(Boolean),
    rawArgs,
  });

  assert.equal(result.content, `Repeat back exactly what follows:\n\n${rawArgs}\n`);
});

test('custom command $ARGUMENTS falls back to the joined args for clients that send no raw text', async () => {
  const result = await executeCustomCommand('Do: $ARGUMENTS ($1/$2)', { args: ['fix', 'tests'] });

  assert.equal(result.content, 'Do: fix tests (fix/tests)');
});

test('custom command arguments are inserted literally, never as replacement patterns or placeholders', async () => {
  // `$&`, `$$`, `` $` `` and `$'` are String#replace patterns, and `$1` typed by
  // the user must not be re-substituted by the positional pass.
  const rawArgs = "costs $1 and $& or $$ then $` and $'";
  const result = await executeCustomCommand('All: $ARGUMENTS\nFirst: $1\nSecond: $2\nFourth: $4\nTenth: $10', {
    args: rawArgs.split(/\s+/),
    rawArgs,
  });

  assert.equal(
    result.content,
    "All: costs $1 and $& or $$ then $` and $'\nFirst: costs\nSecond: $1\nFourth: $&\nTenth: $'",
  );
});

test('custom command placeholders without a matching argument are left as written', async () => {
  const result = await executeCustomCommand('A=$ARGUMENTS B=$2 C=$01 D=$1x', { args: ['only'], rawArgs: 'only' });

  assert.equal(result.content, 'A=only B=$2 C=$01 D=$1x');
});
