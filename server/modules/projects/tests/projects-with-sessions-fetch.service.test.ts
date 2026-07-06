import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, initializeDatabase, projectsDb } from '@/modules/database/index.js';

async function withIsolatedDatabase(runTest: (tempDir: string) => Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'projects-with-sessions-'));

  closeConnection();
  process.env.DATABASE_PATH = path.join(tempDir, 'auth.db');
  await initializeDatabase();

  try {
    await runTest(tempDir);
  } finally {
    closeConnection();
    if (previousDatabasePath === undefined) {
      delete process.env.DATABASE_PATH;
    } else {
      process.env.DATABASE_PATH = previousDatabasePath;
    }
    await rm(tempDir, { recursive: true, force: true });
  }
}

test('projects with Claude worktree paths share repo grouping metadata', async () => {
  await withIsolatedDatabase(async (tempDir) => {
    const repoPath = path.join(tempDir, 'repo');
    const worktreePath = path.join(repoPath, '.claude', 'worktrees', 'feat-wt');
    const staleWorktreePath = path.join(repoPath, '.claude', 'worktrees', 'stale-wt');
    await mkdir(worktreePath, { recursive: true });

    projectsDb.createProjectPath(repoPath);
    projectsDb.createProjectPath(worktreePath);
    projectsDb.createProjectPath(staleWorktreePath);

    const { getProjectsWithSessions } = await import('../services/projects-with-sessions-fetch.service.js');
    const projects = await getProjectsWithSessions({ skipSynchronization: true });

    const main = projects.find((project) => project.fullPath === repoPath);
    const worktree = projects.find((project) => project.fullPath === worktreePath);
    const stale = projects.find((project) => project.fullPath === staleWorktreePath);

    assert.equal(main?.repoGroup, repoPath);
    assert.equal(main?.isMainWorktree, true);
    assert.equal(worktree?.repoGroup, repoPath);
    assert.equal(worktree?.worktreeInfo?.branchName, 'feat-wt');
    assert.equal(worktree?.isStale, false);
    assert.equal(stale?.repoGroup, repoPath);
    assert.equal(stale?.worktreeInfo?.branchName, 'stale-wt');
    assert.equal(stale?.isStale, true);
  });
});
