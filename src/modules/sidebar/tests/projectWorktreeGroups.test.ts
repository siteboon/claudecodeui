import assert from 'node:assert/strict';

import { test } from 'vitest';

import type { Project } from '@/shared/types';
import { groupWorktreeProjects, shouldShowWorktrees } from '@/modules/sidebar/utils/projectWorktreeGroups';

const project = (id: string, fullPath: string, worktreeOf: string | null = null): Project => ({
  projectId: id, displayName: id, fullPath, worktreeOf,
});
const shape = (projects: Project[]) =>
  groupWorktreeProjects(projects).map((g) => [g.project.projectId, g.worktrees.map((w) => w.projectId)]);

test('worktree projects nest under their repository, keeping list order', () => {
  assert.deepEqual(shape([
    project('wt-b', '/src/app-worktrees/b', '/src/app'),
    project('other', '/src/other'),
    project('app', '/src/app'),
    project('wt-a', '/src/app-worktrees/a', '/src/app/'),
  ]), [['other', []], ['app', ['wt-b', 'wt-a']]]);
});

test('a worktree whose repository is not listed stays top-level', () => {
  assert.deepEqual(shape([project('wt', '/src/app-worktrees/a', '/src/app'), project('x', '/x')]), [['wt', []], ['x', []]]);
});

test('nesting is one level deep and never self-referential', () => {
  assert.deepEqual(shape([
    project('app', '/app'),
    project('wt', '/wt', '/app'),
    project('wt-of-wt', '/wt2', '/wt'),
    project('self', '/self', '/self'),
  ]), [['app', ['wt']], ['wt-of-wt', []], ['self', []]]);
});

test('worktree rows stay visible while a worktree itself is expanded (compact single-expansion layout)', () => {
  const worktrees = [project('wt', '/src/app-worktrees/a', '/src/app')];
  // Compact layout: expanding the worktree replaces the expansion set, collapsing the repository.
  const onlyWorktreeExpanded = (id: string) => id === 'wt';
  assert.equal(shouldShowWorktrees('app', worktrees, onlyWorktreeExpanded, null), true);
  assert.equal(shouldShowWorktrees('app', worktrees, (id) => id === 'app', null), true);
  assert.equal(shouldShowWorktrees('app', worktrees, () => false, 'wt'), true);
  assert.equal(shouldShowWorktrees('app', worktrees, () => false, 'other'), false);
  assert.equal(shouldShowWorktrees('app', [], () => true, null), false);
});
