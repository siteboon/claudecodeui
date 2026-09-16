import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import test from 'node:test';

import express from 'express';

import { createGitRouter } from '@/modules/git/git.routes.js';

type SpawnCall = { args: string[]; cwd: string | undefined };

function createRouter(calls: SpawnCall[]) {
  const spawnProcess = ((_command: string, args: string[], options: { cwd?: string }) => {
    calls.push({ args, cwd: options.cwd });
    const child = new EventEmitter() as EventEmitter & { stdout: PassThrough; stderr: PassThrough };
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    process.nextTick(() => {
      if (args[0] === 'rev-parse' && args[1] === '--is-inside-work-tree') {
        child.stdout.write('true\n');
      }
      child.stdout.end();
      child.stderr.end();
      child.emit('close', 0);
    });
    return child;
  }) as Parameters<typeof createGitRouter>[0]['spawnProcess'];
  const unexpectedProvider = async (): Promise<never> => { throw new Error('unexpected provider call'); };
  return createGitRouter({
    fileSystem: { access: async () => undefined } as unknown as Parameters<typeof createGitRouter>[0]['fileSystem'],
    spawnProcess,
    resolveProjectPathById: () => path.resolve('/workspace/project'),
    queryClaude: unexpectedProvider,
    queryCursor: unexpectedProvider,
  });
}

async function withServer(router: express.Router, run: (baseUrl: string) => Promise<void>) {
  const app = express();
  app.use(express.json());
  app.use('/api/git', router);
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const address = server.address() as AddressInfo;
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

test('git status runs inside the nested repository named by repo', async () => {
  const calls: SpawnCall[] = [];
  await withServer(createRouter(calls), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/git/status?project=project-1&repo=firmware%2Fap`);
    const body = await response.json() as { error?: string };
    assert.equal(body.error, undefined);
  });
  assert.ok(calls.length > 0);
  assert.deepEqual(new Set(calls.map((call) => call.cwd)), new Set([path.resolve('/workspace/project/firmware/ap')]));
});

test('git status refuses a repo path that escapes the project without running git', async () => {
  const calls: SpawnCall[] = [];
  await withServer(createRouter(calls), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/git/status?project=project-1&repo=..%2Fother`);
    const body = await response.json() as { error?: string; details?: string };
    assert.equal(body.error, 'Git operation failed');
    assert.match(body.details ?? '', /Invalid repository path/);
  });
  assert.deepEqual(calls, []);
});
