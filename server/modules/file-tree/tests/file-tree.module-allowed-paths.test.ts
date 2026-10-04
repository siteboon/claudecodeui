import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';

import express from 'express';

// ALLOWED_PATHS is read when the shared utils module is first evaluated, and
// the database path when it first connects, so both are set before the
// imports below. This drives the production File Tree wiring, not a test double.
const fixtureRoot = await realpath(await mkdtemp(path.join(os.tmpdir(), 'file-tree-module-allowed-')));
const allowedDirectory = path.join(fixtureRoot, 'allowed');
const insideProjectPath = path.join(allowedDirectory, 'proj-in');
const outsideProjectPath = path.join(fixtureRoot, 'outside', 'proj-out');
const SECRET = 'TOP SECRET';
await mkdir(insideProjectPath, { recursive: true });
await mkdir(outsideProjectPath, { recursive: true });
await writeFile(path.join(insideProjectPath, 'inside.txt'), 'inside', 'utf8');
await writeFile(path.join(outsideProjectPath, 'secret.txt'), SECRET, 'utf8');
await symlink(outsideProjectPath, path.join(insideProjectPath, 'escape'));

const previousEnvironment = {
  ALLOWED_PATHS: process.env.ALLOWED_PATHS,
  DATABASE_PATH: process.env.DATABASE_PATH,
};
process.env.ALLOWED_PATHS = allowedDirectory;
process.env.DATABASE_PATH = path.join(fixtureRoot, 'auth.db');

const { closeConnection, initializeDatabase, projectsDb } = await import('@/modules/database/index.js');
const { fileTreeRoutes } = await import('@/modules/file-tree/index.js');

closeConnection();
await initializeDatabase();
// Registered directly, as for projects added before ALLOWED_PATHS was set.
const insideProjectId = projectsDb.createProjectPath(insideProjectPath, 'proj-in').project?.project_id ?? '';
const outsideProjectId = projectsDb.createProjectPath(outsideProjectPath, 'proj-out').project?.project_id ?? '';

after(async () => {
  closeConnection();
  for (const [name, value] of Object.entries(previousEnvironment)) {
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }
  await rm(fixtureRoot, { recursive: true, force: true });
});

test('the production File Tree API refuses paths outside ALLOWED_PATHS', async () => {
  const app = express().use(express.json()).use('/api/file-tree', fileTreeRoutes);
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');

  try {
    const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/file-tree/projects`;
    const readFile = (projectId: string, filePath: string) =>
      fetch(`${baseUrl}/${encodeURIComponent(projectId)}/file?filePath=${encodeURIComponent(filePath)}`);

    const outside = await readFile(outsideProjectId, 'secret.txt');
    assert.equal(outside.status, 403);
    assert.doesNotMatch(await outside.text(), new RegExp(SECRET));

    const throughSymlink = await readFile(insideProjectId, 'escape/secret.txt');
    assert.equal(throughSymlink.status, 403);
    assert.doesNotMatch(await throughSymlink.text(), new RegExp(SECRET));

    const inside = await readFile(insideProjectId, 'inside.txt');
    assert.equal(inside.status, 200);
    assert.equal((await inside.json() as { content: string }).content, 'inside');
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
