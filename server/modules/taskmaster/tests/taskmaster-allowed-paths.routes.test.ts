import assert from 'node:assert/strict';
import { once } from 'node:events';
import * as fs from 'node:fs';
import * as fsPromises from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';

import express from 'express';

// ALLOWED_PATHS is read when the shared utils module is first evaluated, so it
// is set before the router is imported. `linked` is an allowed project whose
// `.taskmaster` is a symlink to a directory outside the allowed one.
const fixtureRoot = await fsPromises.realpath(await fsPromises.mkdtemp(path.join(os.tmpdir(), 'taskmaster-allowed-')));
const allowedDirectory = path.join(fixtureRoot, 'allowed');
const insideProjectPath = path.join(allowedDirectory, 'app');
const linkedProjectPath = path.join(allowedDirectory, 'linked');
const outsideDirectory = path.join(fixtureRoot, 'outside');
const outsideTaskmasterPath = path.join(outsideDirectory, '.taskmaster');
const SECRET = 'TOP SECRET';
await fsPromises.mkdir(path.join(insideProjectPath, '.taskmaster', 'docs'), { recursive: true });
await fsPromises.writeFile(path.join(insideProjectPath, '.taskmaster', 'docs', 'prd.txt'), 'inside prd', 'utf8');
await fsPromises.writeFile(path.join(insideProjectPath, '.taskmaster', 'docs', 'my prd (v2).md'), 'second prd', 'utf8');
await fsPromises.mkdir(path.join(outsideTaskmasterPath, 'docs'), { recursive: true });
await fsPromises.mkdir(path.join(outsideTaskmasterPath, 'tasks'), { recursive: true });
await fsPromises.writeFile(path.join(outsideDirectory, 'secret.txt'), SECRET, 'utf8');
await fsPromises.writeFile(path.join(outsideTaskmasterPath, 'docs', 'prd.txt'), SECRET, 'utf8');
await fsPromises.writeFile(path.join(outsideTaskmasterPath, 'tasks', 'tasks.json'), JSON.stringify({ tasks: [{ id: 1, title: SECRET }] }), 'utf8');
await fsPromises.mkdir(linkedProjectPath, { recursive: true });
await fsPromises.symlink(outsideTaskmasterPath, path.join(linkedProjectPath, '.taskmaster'));

const previousAllowedPaths = process.env.ALLOWED_PATHS;
process.env.ALLOWED_PATHS = allowedDirectory;

const { createTaskmasterRouter } = await import('../taskmaster.routes.js');

after(async () => {
  if (previousAllowedPaths === undefined) {
    delete process.env.ALLOWED_PATHS;
  } else {
    process.env.ALLOWED_PATHS = previousAllowedPaths;
  }
  await fsPromises.rm(fixtureRoot, { recursive: true, force: true });
});

const projectRoots: Record<string, string> = {
  inside: insideProjectPath,
  linked: linkedProjectPath,
  outside: path.join(outsideDirectory, 'app'),
};

async function withTaskmasterServer(
  fileSystems: { fileSystem: typeof import('node:fs'); fileSystemPromises: typeof import('node:fs/promises') },
  run: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const router = createTaskmasterRouter({
    ...fileSystems,
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
    await run(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/taskmaster`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

function postJson(url: string, body: unknown): Promise<Response> {
  return fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

test('TaskMaster project routes answer 403 for a project outside ALLOWED_PATHS', async () => {
  const missingFileSystems = {
    fileSystem: { existsSync: () => false } as unknown as typeof import('node:fs'),
    fileSystemPromises: {
      access: async () => { throw Object.assign(new Error('missing'), { code: 'ENOENT' }); },
    } as unknown as typeof import('node:fs/promises'),
  };

  await withTaskmasterServer(missingFileSystems, async (baseUrl) => {
    assert.equal((await fetch(`${baseUrl}/tasks/outside`)).status, 403);
    assert.equal((await fetch(`${baseUrl}/prd/outside`)).status, 403);
    assert.equal((await fetch(`${baseUrl}/init/outside`, { method: 'POST' })).status, 403);

    assert.notEqual((await fetch(`${baseUrl}/tasks/inside`)).status, 403);
    assert.equal((await fetch(`${baseUrl}/tasks/unknown`)).status, 404);
  });
});

test('a PRD file name cannot climb out of .taskmaster/docs', async () => {
  const traversal = '../../../../outside/secret.txt';

  await withTaskmasterServer({ fileSystem: fs, fileSystemPromises: fsPromises }, async (baseUrl) => {
    const read = await fetch(`${baseUrl}/prd/inside/${encodeURIComponent(traversal)}`);
    assert.equal(read.status, 400);
    assert.doesNotMatch(await read.text(), new RegExp(SECRET));

    const parse = await postJson(`${baseUrl}/parse-prd/inside`, { fileName: traversal });
    assert.equal(parse.status, 400);

    const template = await postJson(`${baseUrl}/apply-template/inside`, {
      templateId: 'web-app',
      fileName: '../../../../outside/written-by-template.md',
    });
    assert.equal(template.status, 400);
  });

  assert.equal(fs.existsSync(path.join(outsideDirectory, 'written-by-template.md')), false);
});

test('a symlinked .taskmaster cannot read or write outside ALLOWED_PATHS', async () => {
  await withTaskmasterServer({ fileSystem: fs, fileSystemPromises: fsPromises }, async (baseUrl) => {
    for (const route of ['/prd/linked/prd.txt', '/prd/linked', '/tasks/linked']) {
      const response = await fetch(`${baseUrl}${route}`);
      assert.equal(response.status, 403, route);
      assert.doesNotMatch(await response.text(), new RegExp(SECRET), route);
    }

    const save = await postJson(`${baseUrl}/prd/linked`, { fileName: 'written.md', content: 'x' });
    assert.equal(save.status, 403);

    const template = await postJson(`${baseUrl}/apply-template/linked`, { templateId: 'web-app', fileName: 'written.md' });
    assert.equal(template.status, 403);

    const parse = await postJson(`${baseUrl}/parse-prd/linked`, { fileName: 'prd.txt' });
    assert.equal(parse.status, 403);
  });

  assert.deepEqual((await fsPromises.readdir(path.join(outsideTaskmasterPath, 'docs'))).sort(), ['prd.txt']);
});

test('PRD files inside ALLOWED_PATHS are still read by their listed names', async () => {
  await withTaskmasterServer({ fileSystem: fs, fileSystemPromises: fsPromises }, async (baseUrl) => {
    const read = await fetch(`${baseUrl}/prd/inside/prd.txt`);
    assert.equal(read.status, 200);
    assert.equal((await read.json() as { content: string }).content, 'inside prd');

    const second = await fetch(`${baseUrl}/prd/inside/${encodeURIComponent('my prd (v2).md')}`);
    assert.equal(second.status, 200);
    assert.equal((await second.json() as { content: string }).content, 'second prd');
  });
});
