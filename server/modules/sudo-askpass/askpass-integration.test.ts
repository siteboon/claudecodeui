/* eslint-disable boundaries/no-unknown -- integration test wires the real route to the real service */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import test from 'node:test';

import express from 'express';

import internalAskpassRoutes from '../../routes/internal-askpass.js';

import {
  ensureAskpassFiles,
  registerSudoRun,
  resolveSudoPassword,
  setServerPort,
  unregisterSudoRun,
} from './sudo-askpass.service.js';

function startServer(): Promise<{ server: http.Server; port: number }> {
  const app = express();
  app.use(express.json());
  app.use('/internal/askpass', internalAskpassRoutes);
  const server = http.createServer(app);
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      resolve({ server, port });
    });
  });
}

async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('waitFor timed out');
    }
    await new Promise((r) => setTimeout(r, 10));
  }
}

function runHelper(askpassPath: string, prompt: string, env: NodeJS.ProcessEnv) {
  const child = spawn(process.execPath, [askpassPath, prompt], { env });
  let stdout = '';
  child.stdout.on('data', (chunk) => {
    stdout += chunk;
  });
  const code = new Promise<number>((resolve) => child.on('close', (c) => resolve(c ?? -1)));
  return { child, code: () => code, stdout: () => stdout };
}

test('askpass helper fetches the typed password over the loopback route', async () => {
  const { server, port } = await startServer();
  setServerPort(port);

  const sent: string[] = [];
  const ws = { send: (data: string) => sent.push(data) };
  const { token } = registerSudoRun(ws, 'sess-int', 'claude');
  const { askpassPath } = ensureAskpassFiles();

  const helper = runHelper(askpassPath, '[sudo] password for piotr: ', {
    ...process.env,
    AIGM_ASKPASS_TOKEN: token,
    AIGM_ASKPASS_PORT: String(port),
  });

  await waitFor(() => sent.length > 0);
  const requestId = JSON.parse(sent[0]).requestId;
  resolveSudoPassword(requestId, { password: 'hunter2' });

  assert.equal(await helper.code(), 0);
  assert.equal(helper.stdout(), 'hunter2');

  unregisterSudoRun(token);
  await new Promise((r) => server.close(r));
});

test('askpass helper exits non-zero when the token is unknown', async () => {
  const { server, port } = await startServer();
  setServerPort(port);
  const { askpassPath } = ensureAskpassFiles();

  const helper = runHelper(askpassPath, '[sudo] password for x: ', {
    ...process.env,
    AIGM_ASKPASS_TOKEN: 'not-a-real-token',
    AIGM_ASKPASS_PORT: String(port),
  });

  assert.notEqual(await helper.code(), 0);
  assert.equal(helper.stdout(), '');

  await new Promise((r) => server.close(r));
});
