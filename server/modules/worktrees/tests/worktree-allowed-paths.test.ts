import assert from 'node:assert/strict';
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';

import type { GitCommandResult } from '@/shared/types.js';

// ALLOWED_PATHS is read when the shared utils module is first evaluated, so it
// is set before the services are imported. Only the repository and one
// worktree folder are allowed; worktrees otherwise live next to the repository.
const fixtureRoot = await realpath(await mkdtemp(path.join(os.tmpdir(), 'worktree-allowed-')));
const repositoryRoot = path.join(fixtureRoot, 'repo');
const allowedWorktreePath = path.join(fixtureRoot, 'repo-worktrees', 'allowed-branch');
const outsideWorktreePath = path.join(fixtureRoot, 'elsewhere', 'existing');
await mkdir(repositoryRoot, { recursive: true });

const previousAllowedPaths = process.env.ALLOWED_PATHS;
process.env.ALLOWED_PATHS = `${repositoryRoot},${allowedWorktreePath}`;

const { createWorktree } = await import('@/modules/worktrees/services/worktree-create.service.js');
const { removeWorktree } = await import('@/modules/worktrees/services/worktree-remove.service.js');
const { AppError } = await import('@/shared/utils.js');

after(async () => {
  if (previousAllowedPaths === undefined) {
    delete process.env.ALLOWED_PATHS;
  } else {
    process.env.ALLOWED_PATHS = previousAllowedPaths;
  }
  await rm(fixtureRoot, { recursive: true, force: true });
});

const PORCELAIN = [
  `worktree ${repositoryRoot}`,
  'HEAD 1111111111111111111111111111111111111111',
  'branch refs/heads/main',
  '',
  `worktree ${outsideWorktreePath}`,
  'HEAD 2222222222222222222222222222222222222222',
  'branch refs/heads/existing-branch',
  '',
].join('\n');

function createFakeRunner() {
  const calls: string[][] = [];
  const runGit = async (args: string[]): Promise<GitCommandResult> => {
    calls.push(args);
    if (args[0] === 'worktree' && args[1] === 'list') {
      return { stdout: PORCELAIN, stderr: '' };
    }
    return { stdout: '', stderr: '' };
  };
  return { calls, runGit };
}

function isPathNotAllowedError(error: unknown): boolean {
  return error instanceof AppError && error.statusCode === 403 && error.code === 'PATH_NOT_ALLOWED';
}

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

test('a worktree outside ALLOWED_PATHS is not removed', async () => {
  const { calls, runGit } = createFakeRunner();

  await assert.rejects(
    removeWorktree(
      { projectPath: repositoryRoot, worktreePath: outsideWorktreePath, force: true, deleteBranch: false },
      { runGit, projects: { getProjectByPath: () => null, archiveProject: () => undefined } },
    ),
    isPathNotAllowedError,
  );
  assert.equal(calls.some((args) => args[0] === 'worktree' && args[1] === 'remove'), false);
});
