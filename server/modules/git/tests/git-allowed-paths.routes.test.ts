import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import * as fsPromises from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import test, { after } from 'node:test';

import express from 'express';

// ALLOWED_PATHS is read when the shared utils module is first evaluated, so it
// is set before the router is imported.
const fixtureRoot = await fsPromises.realpath(await fsPromises.mkdtemp(path.join(os.tmpdir(), 'git-allowed-')));
const allowedDirectory = path.join(fixtureRoot, 'allowed');
const insideProjectRoot = path.join(allowedDirectory, 'repo');
const outsideProjectRoot = path.join(fixtureRoot, 'outside', 'repo');
const secretFilePath = path.join(outsideProjectRoot, 'secret.txt');
await fsPromises.mkdir(insideProjectRoot, { recursive: true });
await fsPromises.mkdir(outsideProjectRoot, { recursive: true });
await fsPromises.writeFile(secretFilePath, 'secret', 'utf8');
await fsPromises.symlink(outsideProjectRoot, path.join(insideProjectRoot, 'escape'));

const previousAllowedPaths = process.env.ALLOWED_PATHS;
process.env.ALLOWED_PATHS = allowedDirectory;

const { createGitRouter } = await import('@/modules/git/git.routes.js');

after(async () => {
  if (previousAllowedPaths === undefined) {
    delete process.env.ALLOWED_PATHS;
  } else {
    process.env.ALLOWED_PATHS = previousAllowedPaths;
  }
  await fsPromises.rm(fixtureRoot, { recursive: true, force: true });
});

type SpawnProcess = Parameters<typeof createGitRouter>[0]['spawnProcess'];

/**
 * Answers the handful of git commands the routes under test run: the
 * repository checks, the top level, and an untracked `escape/secret.txt`.
 */
function createFakeGit(commands: string[][]): SpawnProcess {
  return ((_command: string, args: string[]) => {
    commands.push(args);
    const child = new EventEmitter() as EventEmitter & { stdout: PassThrough; stderr: PassThrough };
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    let stdout = '';
    if (args[0] === 'rev-parse' && args[1] === '--is-inside-work-tree') stdout = 'true\n';
    if (args[0] === 'rev-parse' && args[1] === '--show-toplevel') stdout = `${insideProjectRoot}\n`;
    if (args[0] === 'status') stdout = '?? escape/secret.txt\n';
    process.nextTick(() => {
      child.stdout.write(stdout);
      child.emit('close', 0);
    });
    return child;
  }) as SpawnProcess;
}

async function withGitServer(commands: string[][], run: (baseUrl: string) => Promise<void>): Promise<void> {
  const unexpectedProvider = async (): Promise<never> => { throw new Error('unexpected provider call'); };
  const projectRoots: Record<string, string> = { inside: insideProjectRoot, outside: outsideProjectRoot };
  const app = express();
  app.use(express.json());
  app.use('/api/git', createGitRouter({
    fileSystem: fsPromises,
    spawnProcess: createFakeGit(commands),
    resolveProjectPathById: (projectId) => projectRoots[projectId] ?? null,
    queryClaude: unexpectedProvider,
    queryCursor: unexpectedProvider,
  }));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    await run(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

test('a project outside ALLOWED_PATHS is refused with 403 before any git command runs', async () => {
  const commands: string[][] = [];

  await withGitServer(commands, async (baseUrl) => {
    const status = await fetch(`${baseUrl}/api/git/status?project=outside`);
    assert.equal(status.status, 403);

    const discard = await fetch(`${baseUrl}/api/git/discard`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ project: 'outside', file: 'secret.txt' }),
    });
    assert.equal(discard.status, 403);
  });

  assert.deepEqual(commands, []);
  assert.equal(await fsPromises.readFile(secretFilePath, 'utf8'), 'secret');
});

test('a project inside ALLOWED_PATHS reaches its git route', async () => {
  const commands: string[][] = [];

  await withGitServer(commands, async (baseUrl) => {
    const status = await fetch(`${baseUrl}/api/git/status?project=inside`);
    assert.notEqual(status.status, 403);
  });

  assert.ok(commands.length > 0);
});

test('a working-tree file reached through a symlink is neither read nor deleted outside ALLOWED_PATHS', async () => {
  const commands: string[][] = [];

  await withGitServer(commands, async (baseUrl) => {
    const diff = await fetch(`${baseUrl}/api/git/diff?project=inside&file=escape/secret.txt`);
    assert.equal(diff.status, 403);
    assert.doesNotMatch(await diff.text(), /secret\n|\+secret/);

    for (const route of ['discard', 'delete-untracked']) {
      const response = await fetch(`${baseUrl}/api/git/${route}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ project: 'inside', file: 'escape/secret.txt' }),
      });
      assert.equal(response.status, 403, route);
    }
  });

  assert.equal(await fsPromises.readFile(secretFilePath, 'utf8'), 'secret');
});
