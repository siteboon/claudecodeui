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

/**
 * Stands in for `providerMcpService`. `listProviderMcpServers` returns the
 * scope-grouped shape the real service returns, and the probe reports one
 * status per server name exactly as the Claude health check does - including
 * the case of a name the health check never mentioned.
 */
function createMcpService(overrides: {
  scopes?: Record<string, unknown[]>;
  report?: Record<string, unknown>;
} = {}) {
  return {
    listProviderMcpServers: async () => overrides.scopes ?? { user: [], local: [], project: [] },
    probeProviderMcpServerStatuses: async () => overrides.report ?? { supported: false, statuses: [] },
  };
}

async function executeCommand(
  commandName: string,
  context: Record<string, unknown>,
  sessionModels: Record<string, string> = {},
  mcpService: ReturnType<typeof createMcpService> = createMcpService(),
): Promise<Record<string, unknown>> {
  const router = createCommandsRouter({
    fileSystem: {
      readFile: async () => JSON.stringify({ name: 'claude-code-ui', version: '0.0.0-test' }),
    } as unknown as typeof import('node:fs/promises'),
    homeDirectory: () => '/home/test',
    appRoot: '/app',
    models: createModelsService(sessionModels) as never,
    mcp: mcpService as never,
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

test('mcp command lists every scope with the status the provider reported', async () => {
  const result = await executeCommand('/mcp', { provider: 'claude', projectPath: '/work/repo' }, {}, createMcpService({
    scopes: {
      user: [{ name: 'internal-http', scope: 'user', transport: 'http', url: 'https://mcp.example/mcp' }],
      project: [{ name: 'repo-tools', scope: 'project', transport: 'stdio', command: 'node', args: ['server.js'] }],
      local: [{ name: 'scratch', scope: 'local', transport: 'stdio', command: 'node', args: ['scratch.js'] }],
    },
    report: {
      supported: true,
      statuses: [
        { name: 'internal-http', state: 'failed', detail: 'Failed to connect - HTTP 401' },
        { name: 'repo-tools', state: 'connected' },
      ],
    },
  }));

  assert.equal(result.action, 'mcp');
  const data = result.data as {
    statusSupported: boolean;
    servers: Array<{ name: string; scope: string; target: string; status: string; statusDetail?: string }>;
  };

  assert.equal(data.statusSupported, true);
  // User scope first, then project, then local - the settings list's order.
  assert.deepEqual(data.servers.map((server) => server.name), ['internal-http', 'repo-tools', 'scratch']);
  assert.equal(data.servers[0].status, 'failed');
  assert.equal(data.servers[0].statusDetail, 'Failed to connect - HTTP 401');
  assert.equal(data.servers[0].target, 'https://mcp.example/mcp');
  assert.equal(data.servers[1].status, 'connected');
  assert.equal(data.servers[1].target, 'node server.js');
  // A server the health check never mentioned stays unknown, never "failed".
  assert.equal(data.servers[2].status, 'unknown');
});

test('mcp command reports unsupported status probing without claiming a failure', async () => {
  const result = await executeCommand('/mcp', { provider: 'codex' }, {}, createMcpService({
    scopes: { user: [{ name: 'codex-tools', scope: 'user', transport: 'stdio', command: 'node' }], local: [], project: [] },
    report: { supported: false, statuses: [] },
  }));

  const data = result.data as {
    provider: string;
    statusSupported: boolean;
    servers: Array<{ status: string }>;
  };

  assert.equal(data.provider, 'codex');
  assert.equal(data.statusSupported, false);
  assert.equal(data.servers[0].status, 'unknown');
});

test('mcp command skips the probe entirely when no servers are configured', async () => {
  let probed = false;
  const mcpService = {
    listProviderMcpServers: async () => ({ user: [], local: [], project: [] }),
    probeProviderMcpServerStatuses: async () => {
      probed = true;
      return { supported: true, statuses: [] };
    },
  };

  const result = await executeCommand('/mcp', { provider: 'claude' }, {}, mcpService as never);

  assert.deepEqual((result.data as { servers: unknown[] }).servers, []);
  assert.equal(probed, false);
});
