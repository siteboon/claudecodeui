import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';

import express, { type NextFunction, type Request, type Response } from 'express';

import type { GitCommandResult } from '@/shared/types.js';

// ALLOWED_PATHS is read when the shared utils module is first evaluated, and
// the database path when it first connects, so both are set before the
// imports below. Only the repository and one worktree folder are allowed;
// worktrees otherwise live next to the repository. `linkedWorktreePath` is an
// allowed worktree of a main repository outside the allowed directories.
// `deniedRepositoryRoot` is outside too, but its sibling worktrees folder is
// allowed, so only the check on the main repository can refuse a new worktree.
const fixtureRoot = await realpath(await mkdtemp(path.join(os.tmpdir(), 'worktree-allowed-')));
const repositoryRoot = path.join(fixtureRoot, 'repo');
const allowedWorktreePath = path.join(fixtureRoot, 'repo-worktrees', 'allowed-branch');
const outsideWorktreePath = path.join(fixtureRoot, 'elsewhere', 'existing');
const outsideRepositoryRoot = path.join(fixtureRoot, 'outside-repo');
const linkedWorktreePath = path.join(fixtureRoot, 'linked');
const deniedRepositoryRoot = path.join(fixtureRoot, 'denied-repo');
const deniedRepositoryWorktreesPath = path.join(fixtureRoot, 'denied-repo-worktrees');
const deniedRepositoryLinkedWorktreePath = path.join(deniedRepositoryWorktreesPath, 'existing');
await mkdir(repositoryRoot, { recursive: true });
await mkdir(outsideRepositoryRoot, { recursive: true });

const previousEnvironment = {
  ALLOWED_PATHS: process.env.ALLOWED_PATHS,
  DATABASE_PATH: process.env.DATABASE_PATH,
};
process.env.ALLOWED_PATHS = [
  repositoryRoot,
  allowedWorktreePath,
  linkedWorktreePath,
  deniedRepositoryWorktreesPath,
].join(',');
process.env.DATABASE_PATH = path.join(fixtureRoot, 'auth.db');

const { createWorktree } = await import('@/modules/worktrees/services/worktree-create.service.js');
const { mergeWorktree } = await import('@/modules/worktrees/services/worktree-merge.service.js');
const { openWorktreeAsProject } = await import('@/modules/worktrees/services/worktree-open.service.js');
const { removeWorktree } = await import('@/modules/worktrees/services/worktree-remove.service.js');
const { closeConnection, initializeDatabase, projectsDb } = await import('@/modules/database/index.js');
const { worktreesRoutes } = await import('@/modules/worktrees/index.js');
const { AppError } = await import('@/shared/utils.js');

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

function buildPorcelain(worktrees: Array<{ path: string; branch: string }>): string {
  return worktrees
    .flatMap((worktree, index) => [
      `worktree ${worktree.path}`,
      `HEAD ${String(index + 1).repeat(40)}`,
      `branch refs/heads/${worktree.branch}`,
      '',
    ])
    .join('\n');
}

const PORCELAIN = buildPorcelain([
  { path: repositoryRoot, branch: 'main' },
  { path: outsideWorktreePath, branch: 'existing-branch' },
]);

const OUTSIDE_MAIN_PORCELAIN = buildPorcelain([
  { path: outsideRepositoryRoot, branch: 'main' },
  { path: linkedWorktreePath, branch: 'linked-branch' },
]);

const DENIED_MAIN_PORCELAIN = buildPorcelain([
  { path: deniedRepositoryRoot, branch: 'main' },
  { path: deniedRepositoryLinkedWorktreePath, branch: 'existing-branch' },
]);

function createFakeRunner(porcelain = PORCELAIN) {
  const calls: string[][] = [];
  const runGit = async (args: string[]): Promise<GitCommandResult> => {
    calls.push(args);
    if (args[0] === 'worktree' && args[1] === 'list') {
      return { stdout: porcelain, stderr: '' };
    }
    return { stdout: '', stderr: '' };
  };
  return { calls, runGit };
}

function isPathNotAllowedError(error: unknown): boolean {
  return error instanceof AppError && error.statusCode === 403 && error.code === 'PATH_NOT_ALLOWED';
}

function ranOnlyWorktreeList(calls: string[][]): boolean {
  return calls.every((args) => args[0] === 'worktree' && args[1] === 'list');
}

const unexpectedProjects = {
  getProjectByPath: () => null,
  createProject: async (): Promise<never> => { throw new Error('createProject should not run'); },
  restoreProject: async (): Promise<never> => { throw new Error('restoreProject should not run'); },
  archiveProject: () => undefined,
};

test('a worktree folder outside ALLOWED_PATHS is refused before git creates it', async () => {
  const { calls, runGit } = createFakeRunner();

  await assert.rejects(
    createWorktree(
      { projectPath: repositoryRoot, branch: 'feature/login' },
      { runGit, fileSystem: { pathExists: async () => false } },
    ),
    isPathNotAllowedError,
  );
  assert.equal(calls.some((args) => args[0] === 'worktree' && args[1] === 'add'), false);

  const allowed = await createWorktree(
    { projectPath: repositoryRoot, branch: 'allowed-branch' },
    { runGit, fileSystem: { pathExists: async () => false } },
  );
  assert.equal(allowed.worktreePath, allowedWorktreePath);
  assert.ok(calls.some((args) => args[0] === 'worktree' && args[1] === 'add'));
});

test('a worktree outside ALLOWED_PATHS is not removed, merged or opened', async () => {
  const removeRunner = createFakeRunner();
  await assert.rejects(
    removeWorktree(
      { projectPath: repositoryRoot, worktreePath: outsideWorktreePath, force: true, deleteBranch: false },
      { runGit: removeRunner.runGit, projects: unexpectedProjects },
    ),
    isPathNotAllowedError,
  );
  assert.ok(ranOnlyWorktreeList(removeRunner.calls));

  const mergeRunner = createFakeRunner();
  await assert.rejects(
    mergeWorktree(
      { projectPath: repositoryRoot, worktreePath: outsideWorktreePath, squash: false, removeAfterMerge: false },
      {
        runGit: mergeRunner.runGit,
        removeWorktree: async () => { throw new Error('removeWorktree should not run'); },
      },
    ),
    isPathNotAllowedError,
  );
  assert.ok(ranOnlyWorktreeList(mergeRunner.calls));

  const openRunner = createFakeRunner();
  await assert.rejects(
    openWorktreeAsProject(
      { projectPath: repositoryRoot, worktreePath: outsideWorktreePath },
      { runGit: openRunner.runGit, projects: unexpectedProjects },
    ),
    isPathNotAllowedError,
  );
});

test('an allowed worktree whose main repository is outside ALLOWED_PATHS cannot create, merge or remove', async () => {
  const createRunner = createFakeRunner(OUTSIDE_MAIN_PORCELAIN);
  await assert.rejects(
    createWorktree(
      { projectPath: linkedWorktreePath, branch: 'another' },
      { runGit: createRunner.runGit, fileSystem: { pathExists: async () => false } },
    ),
    isPathNotAllowedError,
  );
  assert.ok(ranOnlyWorktreeList(createRunner.calls));

  const mergeRunner = createFakeRunner(OUTSIDE_MAIN_PORCELAIN);
  await assert.rejects(
    mergeWorktree(
      { projectPath: linkedWorktreePath, worktreePath: linkedWorktreePath, squash: false, removeAfterMerge: false },
      {
        runGit: mergeRunner.runGit,
        removeWorktree: async () => { throw new Error('removeWorktree should not run'); },
      },
    ),
    isPathNotAllowedError,
  );
  assert.ok(ranOnlyWorktreeList(mergeRunner.calls));

  const removeRunner = createFakeRunner(OUTSIDE_MAIN_PORCELAIN);
  await assert.rejects(
    removeWorktree(
      { projectPath: linkedWorktreePath, worktreePath: linkedWorktreePath, force: true, deleteBranch: true },
      { runGit: removeRunner.runGit, projects: unexpectedProjects },
    ),
    isPathNotAllowedError,
  );
  assert.ok(ranOnlyWorktreeList(removeRunner.calls));
});

test('a new worktree in an allowed folder is refused when its main repository is outside ALLOWED_PATHS', async () => {
  const { calls, runGit } = createFakeRunner(DENIED_MAIN_PORCELAIN);

  // The new folder (`denied-repo-worktrees/feature-new`) is allowed, but git
  // would record the branch and the worktree in the main repository.
  await assert.rejects(
    createWorktree(
      { projectPath: deniedRepositoryLinkedWorktreePath, branch: 'feature/new' },
      { runGit, fileSystem: { pathExists: async () => false } },
    ),
    isPathNotAllowedError,
  );
  // No `git branch --list` and no `git worktree add`.
  assert.ok(ranOnlyWorktreeList(calls));
});

test('the Worktrees API refuses a project registered outside ALLOWED_PATHS', async () => {
  closeConnection();
  await initializeDatabase();
  // Registered directly, as for a project added before ALLOWED_PATHS was set.
  const outsideProjectId = projectsDb.createProjectPath(outsideRepositoryRoot, 'outside-repo').project?.project_id ?? '';
  assert.ok(outsideProjectId);

  const app = express();
  app.use(express.json());
  app.use('/api/worktrees', worktreesRoutes);
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
    const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/worktrees`;
    const list = await fetch(`${baseUrl}?project=${encodeURIComponent(outsideProjectId)}`);
    assert.equal(list.status, 403);
    assert.equal((await list.json() as { error: { code: string } }).error.code, 'PATH_NOT_ALLOWED');

    const create = await fetch(`${baseUrl}/create`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ project: outsideProjectId, branch: 'feature/x' }),
    });
    assert.equal(create.status, 403);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
