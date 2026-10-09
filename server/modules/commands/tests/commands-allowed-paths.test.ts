import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import test, { after } from 'node:test';

import express from 'express';

// ALLOWED_PATHS is read when the shared utils module is first evaluated, so it
// is set before the router is imported. The paths need not exist.
const previousAllowedPaths = process.env.ALLOWED_PATHS;
process.env.ALLOWED_PATHS = '/srv/cloudcli-allowed';

const { createCommandsRouter } = await import('../commands.routes.js');

after(() => {
  if (previousAllowedPaths === undefined) {
    delete process.env.ALLOWED_PATHS;
  } else {
    process.env.ALLOWED_PATHS = previousAllowedPaths;
  }
});

test('command routes refuse a project path outside ALLOWED_PATHS', async () => {
  const readPaths: string[] = [];
  const router = createCommandsRouter({
    fileSystem: {
      readdir: async (directoryPath: string) => {
        readPaths.push(directoryPath);
        return [];
      },
      access: async (filePath: string) => {
        readPaths.push(filePath);
      },
      readFile: async (filePath: string) => {
        readPaths.push(filePath);
        return '';
      },
    } as unknown as typeof import('node:fs/promises'),
    homeDirectory: () => '/home/test',
    appRoot: '/app',
    models: {} as never,
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
    const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/commands`;
    const post = (route: string, body: Record<string, unknown>) => fetch(`${baseUrl}/${route}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

    assert.equal((await post('list', { projectPath: '/srv/cloudcli-outside/app' })).status, 403);
    assert.equal(
      (await post('execute', { commandName: '/memory', context: { projectPath: '/srv/cloudcli-outside/app' } })).status,
      403,
    );
    assert.deepEqual(readPaths.filter((readPath) => readPath.startsWith('/srv/cloudcli-outside')), []);

    assert.equal((await post('list', { projectPath: '/srv/cloudcli-allowed/app' })).status, 200);
    assert.equal(
      (await post('execute', { commandName: '/memory', context: { projectPath: '/srv/cloudcli-allowed/app' } })).status,
      200,
    );
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
