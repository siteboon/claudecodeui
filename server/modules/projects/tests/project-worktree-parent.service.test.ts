import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { resolveWorktreeParent } from '@/modules/projects/services/project-worktree-parent.service.js';

function makeRepoWithWorktree() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'wt-parent-')));
  const repo = path.join(root, 'app');
  fs.mkdirSync(repo);
  const git = (cwd: string, ...args: string[]) =>
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd, stdio: 'pipe' });
  git(repo, 'init', '-q');
  git(repo, 'commit', '-q', '--allow-empty', '-m', 'init');
  const worktree = path.join(root, 'app-worktrees', 'feature');
  git(repo, 'worktree', 'add', '-q', '-b', 'feature', worktree);
  return { root, repo, worktree, git };
}

test('a live linked worktree resolves to its main repository', () => {
  const { root, repo, worktree } = makeRepoWithWorktree();
  try {
    assert.equal(resolveWorktreeParent(worktree, new Set()), repo);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('the main repository itself and plain directories have no parent', () => {
  const { root, repo } = makeRepoWithWorktree();
  try {
    assert.equal(resolveWorktreeParent(repo, new Set()), null);
    assert.equal(resolveWorktreeParent(root, new Set()), null);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a removed worktree in the <repo>-worktrees layout resolves only to a known project', () => {
  const { root, repo, worktree, git } = makeRepoWithWorktree();
  try {
    git(repo, 'worktree', 'remove', worktree);
    assert.equal(resolveWorktreeParent(worktree, new Set([repo])), repo);
    assert.equal(resolveWorktreeParent(worktree, new Set()), null);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('an unrelated missing directory is never guessed', () => {
  assert.equal(resolveWorktreeParent('/nowhere/at/all', new Set(['/nowhere/at'])), null);
});
