import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import test, { after } from 'node:test';
import { fileURLToPath } from 'node:url';

import express, { type NextFunction, type Request, type Response } from 'express';

// ALLOWED_PATHS and WORKSPACES_ROOT are read when the shared utils module is
// first evaluated, and the database path when it first connects, so all of
// them are set before the dynamic imports below. The fixture lives beside this
// file because workspaces under the temp directory are always refused.
const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const fixtureRoot = await realpath(await mkdtemp(path.join(testDirectory, 'projects-allowed-paths-fixture-')));
const allowedDirectory = path.join(fixtureRoot, 'allowed');
const insideProjectPath = path.join(allowedDirectory, 'proj-in');
const outsideProjectPath = path.join(fixtureRoot, 'outside', 'proj-out');
await mkdir(insideProjectPath, { recursive: true });
await mkdir(outsideProjectPath, { recursive: true });

const previousEnvironment = {
  ALLOWED_PATHS: process.env.ALLOWED_PATHS,
  WORKSPACES_ROOT: process.env.WORKSPACES_ROOT,
  DATABASE_PATH: process.env.DATABASE_PATH,
};
process.env.ALLOWED_PATHS = allowedDirectory;
delete process.env.WORKSPACES_ROOT;
process.env.DATABASE_PATH = path.join(fixtureRoot, 'auth.db');

const { closeConnection, initializeDatabase, projectsDb } = await import('@/modules/database/index.js');
const { default: projectsRouter } = await import('@/modules/projects/projects.routes.js');
const { AppError } = await import('@/shared/utils.js');

closeConnection();
await initializeDatabase();
// Both rows exist before the request, as for projects registered before
// ALLOWED_PATHS was set.
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

async function withProjectsServer(run: (baseUrl: string) => Promise<void>): Promise<void> {
  const app = express();
  app.use(express.json());
  app.use('/api/projects', projectsRouter);
  // Mirrors the global error middleware in server/index.ts.
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof AppError) {
      res.status(error.statusCode).json({ success: false, error: { code: error.code, message: error.message } });
      return;
    }
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR' } });
  });

  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    await run(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

async function readErrorCode(response: globalThis.Response): Promise<string | undefined> {
  const body = await response.json() as { error?: { code?: string } };
  return body.error?.code;
}

test('the project list leaves out projects outside ALLOWED_PATHS', async () => {
  await withProjectsServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/projects?skipSync=1`);
    const projects = await response.json() as Array<{ projectId: string; path: string }>;

    assert.equal(response.status, 200);
    assert.deepEqual(projects.map((project) => project.path), [insideProjectPath]);
  });
});

test('the archived list leaves out projects outside ALLOWED_PATHS', async () => {
  projectsDb.updateProjectIsArchivedById(insideProjectId, true);
  projectsDb.updateProjectIsArchivedById(outsideProjectId, true);

  try {
    await withProjectsServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/projects/archived`);
      const body = await response.json() as { data: { projects: Array<{ path: string }> } };

      assert.equal(response.status, 200);
      assert.deepEqual(body.data.projects.map((project) => project.path), [insideProjectPath]);
    });
  } finally {
    projectsDb.updateProjectIsArchivedById(insideProjectId, false);
    projectsDb.updateProjectIsArchivedById(outsideProjectId, false);
  }
});

test('by-id routes answer 403 for a project outside ALLOWED_PATHS and leave it untouched', async () => {
  await withProjectsServer(async (baseUrl) => {
    const sessions = await fetch(`${baseUrl}/api/projects/${outsideProjectId}/sessions`);
    assert.equal(sessions.status, 403);
    assert.equal(await readErrorCode(sessions), 'PATH_NOT_ALLOWED');

    const rename = await fetch(`${baseUrl}/api/projects/${outsideProjectId}/rename`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ displayName: 'renamed' }),
    });
    assert.equal(rename.status, 403);

    const removal = await fetch(`${baseUrl}/api/projects/${outsideProjectId}?force=true`, { method: 'DELETE' });
    assert.equal(removal.status, 403);

    const taskmaster = await fetch(`${baseUrl}/api/projects/${outsideProjectId}/taskmaster`);
    assert.equal(taskmaster.status, 403);
  });

  const outsideRow = projectsDb.getProjectById(outsideProjectId);
  assert.equal(outsideRow?.custom_project_name, 'proj-out');
});

test('by-id routes keep working inside ALLOWED_PATHS and still 404 for unknown ids', async () => {
  await withProjectsServer(async (baseUrl) => {
    const inside = await fetch(`${baseUrl}/api/projects/${insideProjectId}/sessions`);
    assert.equal(inside.status, 200);

    const unknown = await fetch(`${baseUrl}/api/projects/does-not-exist/sessions`);
    assert.equal(unknown.status, 404);
  });
});

test('creating a project outside ALLOWED_PATHS answers 403 PATH_NOT_ALLOWED', async () => {
  await withProjectsServer(async (baseUrl) => {
    const outside = await fetch(`${baseUrl}/api/projects/create-project`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: path.join(fixtureRoot, 'outside', 'new-project') }),
    });
    assert.equal(outside.status, 403);
    assert.equal(await readErrorCode(outside), 'PATH_NOT_ALLOWED');

    const prefixSibling = await fetch(`${baseUrl}/api/projects/create-project`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: `${allowedDirectory}10` }),
    });
    assert.equal(prefixSibling.status, 403);

    const inside = await fetch(`${baseUrl}/api/projects/create-project`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: path.join(allowedDirectory, 'new-project') }),
    });
    assert.equal(inside.status, 200);
  });

  assert.equal(projectsDb.getProjectPath(path.join(fixtureRoot, 'outside', 'new-project')), null);
});
