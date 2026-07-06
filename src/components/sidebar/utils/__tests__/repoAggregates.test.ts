import assert from 'node:assert/strict';
import test from 'node:test';

import type { Project } from '../../../../types/app';

import { branchChipColorIndex, getRepoSessionTotal, getRepoSessions } from '../repoAggregates';
import { groupProjectsByRepo } from '../utils';

const makeProject = (overrides: Partial<Project> & { projectId: string }): Project => ({
  displayName: overrides.projectId,
  fullPath: `/tmp/${overrides.projectId}`,
  ...overrides,
});

test('repo sessions are sorted by recency and tagged with owning project id', () => {
  const main = makeProject({
    projectId: 'main',
    sessions: [
      { id: 'a', lastActivity: '2026-04-25T10:00:00Z' },
      { id: 'b', lastActivity: '2026-04-25T08:00:00Z' },
    ],
  });
  const worktree = makeProject({
    projectId: 'wt',
    sessions: [{ id: 'c', lastActivity: '2026-04-25T09:00:00Z' }],
  });

  const result = getRepoSessions([main, worktree]);

  assert.deepEqual(result.map((session) => session.id), ['a', 'c', 'b']);
  assert.deepEqual(result.map((session) => session.__projectId), ['main', 'wt', 'main']);
});

test('repo session total prefers server totals', () => {
  assert.equal(getRepoSessionTotal([
    makeProject({ projectId: 'main', sessionMeta: { total: 8 } }),
    makeProject({ projectId: 'wt', sessions: [{ id: 'c' }] }),
  ]), 9);
});

test('branch chip color index stays in palette bounds', () => {
  for (const branch of ['main', 'feat/x', 'fix/y', 'release/v1', '']) {
    const index = branchChipColorIndex(branch);
    assert.equal(index >= 0, true);
    assert.equal(index < 5, true);
  }
});

test('projects are grouped by repo with main checkout first', () => {
  const main = makeProject({ projectId: 'main', repoGroup: '/repo', isMainWorktree: true });
  const worktree = makeProject({
    projectId: 'wt',
    repoGroup: '/repo',
    worktreeInfo: {
      isWorktree: true,
      worktreeRoot: '/repo/.claude/worktrees/feature',
      mainRepoRoot: '/repo',
      branchName: 'feature',
    },
  });

  assert.deepEqual(groupProjectsByRepo([worktree, main]), [{
    key: '/repo',
    mainProject: main,
    linkedWorktrees: [worktree],
    projects: [main, worktree],
  }]);
});
