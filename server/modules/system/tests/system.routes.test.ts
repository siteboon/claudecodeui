import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import test from 'node:test';

import express from 'express';

import { createSystemRouter } from '../system.routes.js';
import { createSystemUpdateService } from '../system.service.js';

test('update responds immediately and exposes the result once the background run finishes', async () => {
  let finishCommand: (result: { exitCode: number; output: string; errorOutput: string }) => void = () => undefined;
  const service = createSystemUpdateService({
    appRoot: '/app/cloudcli',
    homeDirectory: '/home/cloudcli',
    installMode: 'git',
    isPlatform: false,
    environment: {},
    runShellCommand: () => new Promise((resolve) => { finishCommand = resolve; }),
    createDirectory: async () => undefined,
    moveDirectory: async () => undefined,
    removeDirectory: async () => undefined,
    logInfo: () => undefined,
    logError: () => undefined,
  });
  const app = express();
  app.use('/api/system', createSystemRouter(service));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');

  try {
    const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/system/update`;

    assert.equal((await fetch(baseUrl)).status, 404);
    assert.equal((await fetch(baseUrl, { method: 'POST' })).status, 202);
    assert.equal((await fetch(baseUrl)).status, 202);

    finishCommand({ exitCode: 1, output: '', errorOutput: 'npm failed' });
    await new Promise((resolve) => setImmediate(resolve));

    const finished = await fetch(baseUrl);
    assert.equal(finished.status, 500);
    assert.equal(((await finished.json()) as { errorOutput: string }).errorOutput, 'npm failed');
  } finally {
    server.close();
  }
});
