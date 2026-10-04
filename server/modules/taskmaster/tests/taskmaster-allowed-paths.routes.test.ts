import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import test, { after } from 'node:test';

import express from 'express';

// ALLOWED_PATHS is read when the shared utils module is first evaluated, so it
// is set before the router is imported. The paths need not exist.
const previousAllowedPaths = process.env.ALLOWED_PATHS;
process.env.ALLOWED_PATHS = '/srv/cloudcli-allowed';

const { createTaskmasterRouter } = await import('../taskmaster.routes.js');

after(() => {
  if (previousAllowedPaths === undefined) {
    delete process.env.ALLOWED_PATHS;
  } else {
    process.env.ALLOWED_PATHS = previousAllowedPaths;
  }
});

test('TaskMaster project routes answer 403 for a project outside ALLOWED_PATHS', async () => {
  const projectRoots: Record<string, string> = {
    inside: '/srv/cloudcli-allowed/app',
    outside: '/srv/cloudcli-outside/app',
  };
  const router = createTaskmasterRouter({
    fileSystem: { existsSync: () => false } as unknown as typeof import('node:fs'),
    fileSystemPromises: {
      access: async () => { throw Object.assign(new Error('missing'), { code: 'ENOENT' }); },
    } as unknown as typeof import('node:fs/promises'),
    spawnProcess: (() => { throw new Error('spawn should not run'); }) as unknown as
      Parameters<typeof createTaskmasterRouter>[0]['spawnProcess'],
    resolveProjectPathById: (projectId) => projectRoots[projectId] ?? null,
    taskmasterService: {
      detectMcpServer: async () => ({ hasMCPServer: false, reason: 'Not configured', hasConfig: false }),
    },
  });
  const app = express().use(express.json()).use('/api/taskmaster', router);
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');

  try {
    const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/taskmaster`;
    assert.equal((await fetch(`${baseUrl}/tasks/outside`)).status, 403);
    assert.equal((await fetch(`${baseUrl}/prd/outside`)).status, 403);
    assert.equal((await fetch(`${baseUrl}/init/outside`, { method: 'POST' })).status, 403);

    assert.notEqual((await fetch(`${baseUrl}/tasks/inside`)).status, 403);
    assert.equal((await fetch(`${baseUrl}/tasks/unknown`)).status, 404);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
