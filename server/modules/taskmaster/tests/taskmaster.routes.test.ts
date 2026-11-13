import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import test from 'node:test';

import express from 'express';

import { connectedClients } from '@/modules/websocket/index.js';

import { closeTasksFileWatchers, createTaskmasterRouter } from '../taskmaster.routes.js';

test('a tasks.json edit made outside the routes is broadcast once the tasks were read', async () => {
  const projectPath = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'tm-watch-'));
  const tasksFile = path.join(projectPath, '.taskmaster', 'tasks', 'tasks.json');
  await fsPromises.mkdir(path.dirname(tasksFile), { recursive: true });
  await fsPromises.writeFile(tasksFile, JSON.stringify({ master: { tasks: [{ id: 1, status: 'pending' }] } }));

  const chatClient = { readyState: 1, frames: [] as string[], send(data: string) { this.frames.push(data); } };
  const router = createTaskmasterRouter({
    fileSystem: fs,
    fileSystemPromises: fsPromises,
    spawnProcess: (() => { throw new Error('spawn should not run'); }) as unknown as
      Parameters<typeof createTaskmasterRouter>[0]['spawnProcess'],
    resolveProjectPathById: () => projectPath,
    taskmasterService: {
      detectMcpServer: async () => ({ hasMCPServer: false, reason: 'Not configured', hasConfig: false }),
    },
  });
  const app = express().use('/api/taskmaster', router);
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  connectedClients.add(chatClient as never);
  try {
    const address = server.address() as AddressInfo;
    const response = await fetch(`http://127.0.0.1:${address.port}/api/taskmaster/tasks/project-7`);
    assert.equal(response.status, 200);
    await new Promise((resolve) => setTimeout(resolve, 300)); // let the watcher settle

    await fsPromises.writeFile(tasksFile, JSON.stringify({ master: { tasks: [{ id: 1, status: 'review' }] } }));
    const deadline = Date.now() + 5000;
    while (chatClient.frames.length === 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.equal(chatClient.frames.length, 1);
    const frame = JSON.parse(chatClient.frames[0]) as Record<string, unknown>;
    assert.equal(frame.type, 'taskmaster-tasks-updated');
    assert.equal(frame.projectId, 'project-7');
  } finally {
    connectedClients.clear();
    await closeTasksFileWatchers();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await fsPromises.rm(projectPath, { recursive: true, force: true });
  }
});

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

test('TaskMaster broadcasts reach only the tracked chat clients', async () => {
  const child = new EventEmitter() as EventEmitter & {
    stdin: PassThrough;
    stdout: PassThrough;
    stderr: PassThrough;
  };
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();

  const chatClient = { readyState: 1, frames: [] as string[], send(data: string) { this.frames.push(data); } };
  const closingClient = { readyState: 3, frames: [] as string[], send(data: string) { this.frames.push(data); } };

  const router = createTaskmasterRouter({
    fileSystem: { constants: { F_OK: 0 } } as typeof import('node:fs'),
    fileSystemPromises: {
      access: async () => { throw new Error('not initialized'); },
    } as unknown as typeof import('node:fs/promises'),
    spawnProcess: (() => {
      process.nextTick(() => child.emit('close', 0));
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

  connectedClients.add(chatClient as never);
  connectedClients.add(closingClient as never);
  try {
    const address = server.address() as AddressInfo;
    const response = await fetch(`http://127.0.0.1:${address.port}/api/taskmaster/init/project-1`, {
      method: 'POST',
    });
    assert.equal(response.status, 200);

    assert.equal(chatClient.frames.length, 1);
    const frame = JSON.parse(chatClient.frames[0]) as Record<string, unknown>;
    assert.equal(frame.type, 'taskmaster-project-updated');
    assert.equal(frame.projectId, 'project-1');
    assert.equal(closingClient.frames.length, 0);
  } finally {
    connectedClients.clear();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
