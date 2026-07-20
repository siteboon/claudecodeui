import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { PassThrough } from 'node:stream';
import test from 'node:test';

import express from 'express';

import { createTaskmasterRouter } from '../taskmaster.routes.js';

test('tasks route resolves project ids through the injected project adapter', async () => {
  const resolvedIds: string[] = [];
  const router = createTaskmasterRouter({
    fileSystem: {} as typeof import('node:fs'),
    fileSystemPromises: {} as typeof import('node:fs/promises'),
    spawnProcess: (() => { throw new Error('spawn should not run'); }) as unknown as
      Parameters<typeof createTaskmasterRouter>[0]['spawnProcess'],
    resolveProjectPathById: (projectId) => { resolvedIds.push(projectId); return null; },
    taskmasterService: {
      detectMcpServer: async () => ({
        hasMCPServer: false,
        reason: 'Not configured',
        hasConfig: false,
      }),
    },
  });
  const app = express().use('/api/taskmaster', router);
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const address = server.address() as AddressInfo;
    const response = await fetch(`http://127.0.0.1:${address.port}/api/taskmaster/tasks/project-1`);
    assert.equal(response.status, 404);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  assert.deepEqual(resolvedIds, ['project-1']);
});

test('MCP status route delegates detection to the injected TaskMaster service', async () => {
  let detectionCount = 0;
  const router = createTaskmasterRouter({
    fileSystem: {} as typeof import('node:fs'),
    fileSystemPromises: {} as typeof import('node:fs/promises'),
    spawnProcess: (() => { throw new Error('spawn should not run'); }) as unknown as
      Parameters<typeof createTaskmasterRouter>[0]['spawnProcess'],
    resolveProjectPathById: () => null,
    taskmasterService: {
      detectMcpServer: async () => {
        detectionCount += 1;
        return {
          hasMCPServer: true,
          isConfigured: true,
          hasApiKeys: false,
          scope: 'user',
          config: {
            command: 'npx',
            args: ['-y', 'task-master-ai'],
            url: null,
            envVars: [],
            type: 'stdio',
          },
        };
      },
    },
  });
  const app = express().use('/api/taskmaster', router);
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');

  try {
    const address = server.address() as AddressInfo;
    const response = await fetch(`http://127.0.0.1:${address.port}/api/taskmaster/mcp-status`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      hasMCPServer: true,
      isConfigured: true,
      hasApiKeys: false,
      scope: 'user',
      config: {
        command: 'npx',
        args: ['-y', 'task-master-ai'],
        url: null,
        envVars: [],
        type: 'stdio',
      },
    });
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  assert.equal(detectionCount, 1);
});

test('TaskMaster process errors use the endpoint failure response and settle once', async () => {
  const child = new EventEmitter() as EventEmitter & {
    stdin: PassThrough;
    stdout: PassThrough;
    stderr: PassThrough;
  };
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();

  const router = createTaskmasterRouter({
    fileSystem: { constants: { F_OK: 0 } } as typeof import('node:fs'),
    fileSystemPromises: {
      access: async () => { throw new Error('not initialized'); },
    } as unknown as typeof import('node:fs/promises'),
    spawnProcess: (() => {
      process.nextTick(() => {
        child.emit('error', new Error('spawn failed'));
        child.emit('close', 1);
      });
      return child;
    }) as unknown as Parameters<typeof createTaskmasterRouter>[0]['spawnProcess'],
    resolveProjectPathById: () => '/workspace/project',
    taskmasterService: {
      detectMcpServer: async () => ({
        hasMCPServer: false,
        reason: 'Not configured',
        hasConfig: false,
      }),
    },
  });
  const app = express().use('/api/taskmaster', router);
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');

  try {
    const address = server.address() as AddressInfo;
    const response = await fetch(`http://127.0.0.1:${address.port}/api/taskmaster/init/project-1`, {
      method: 'POST',
    });
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), {
      error: 'Failed to initialize TaskMaster',
      message: 'spawn failed',
      code: null,
    });
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
