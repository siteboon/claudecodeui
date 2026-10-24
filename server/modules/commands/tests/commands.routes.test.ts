import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import test from 'node:test';

import express from 'express';

import { createCommandsRouter } from '@/modules/commands/commands.routes.js';

type CommandsListResponse = {
  builtIn?: Array<{ name: string }>;
  native?: Array<{ name: string }>;
  count?: number;
};

/**
 * The router declares the whole fs/promises module as its adapter, but the
 * list route only walks the custom-command directories; an empty readdir and
 * a writable-looking home directory keep the collision behavior under test
 * down to the built-in and native lists alone.
 */
function createListRouteDependencies() {
  return {
    fileSystem: {
      access: async () => undefined,
      readdir: async () => [],
      readFile: async () => '',
    } as unknown as typeof import('node:fs/promises'),
    homeDirectory: () => '/home/tester',
    appRoot: '/app',
    models: {} as typeof import('@/modules/providers/index.js').providerModelsService,
    runtime: {
      uptime: () => 0,
      memoryUsage: () => ({ rss: 0 }) as NodeJS.MemoryUsage,
      version: 'test',
      platform: 'linux' as NodeJS.Platform,
      pid: 0,
    },
  };
}

async function withCommandsServer(run: (baseUrl: string) => Promise<void>): Promise<void> {
  const app = express();
  app.use(express.json());
  app.use('/api/commands', createCommandsRouter(createListRouteDependencies()));

  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');

  try {
    const address = server.address() as AddressInfo;
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

async function listCommands(baseUrl: string, provider: string): Promise<CommandsListResponse> {
  const response = await fetch(`${baseUrl}/api/commands/list`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider }),
  });
  assert.equal(response.status, 200);
  return (await response.json()) as CommandsListResponse;
}

test('a native command colliding with a built-in wins on its own provider', async () => {
  await withCommandsServer(async (baseUrl) => {
    // Codex documents its own /status (session configuration and token
    // usage). Dropping it in favor of the server's application status would
    // advertise a command the user can never invoke.
    const codex = await listCommands(baseUrl, 'codex');

    const nativeNames = (codex.native ?? []).map((command) => command.name);
    assert.ok(nativeNames.includes('/status'), 'codex native list must carry /status');

    const codexBuiltInNames = (codex.builtIn ?? []).map((command) => command.name);
    assert.ok(!codexBuiltInNames.includes('/status'), 'the server /status must yield on codex');
  });
});

test('the same built-in stays available where no native command collides', async () => {
  await withCommandsServer(async (baseUrl) => {
    // Claude's fallback catalogue has no /status of its own, so the server
    // built-in must survive there — the collision scoping is per provider.
    const claude = await listCommands(baseUrl, 'claude');

    const builtInNames = (claude.builtIn ?? []).map((command) => command.name);
    assert.ok(builtInNames.includes('/status'));

    const nativeNames = (claude.native ?? []).map((command) => command.name);
    assert.ok(!nativeNames.includes('/status'));
  });
});
