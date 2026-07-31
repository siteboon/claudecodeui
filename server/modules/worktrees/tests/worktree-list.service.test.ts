import assert from 'node:assert/strict';
import test from 'node:test';

import { listWorktrees } from '@/modules/worktrees/services/worktree-list.service.js';
import type { GitCommandResult } from '@/shared/types.js';

test('listWorktrees bounds concurrent per-worktree Git inspection and preserves ordering', async () => {
  const entryCount = 10;
  const porcelain = Array.from({ length: entryCount }, (_, index) => [
    `worktree /workspace/repo-${index}`,
    `HEAD ${String(index).padStart(40, '0')}`,
    `branch refs/heads/${index === 0 ? 'main' : `feature/${index}`}`,
    '',
  ].join('\n')).join('\n');
  let activeCommands = 0;
  let maximumActiveCommands = 0;

  const runGit = async (args: string[]): Promise<GitCommandResult> => {
    if (args[0] === 'worktree') {
      return { stdout: porcelain, stderr: '' };
    }

    activeCommands += 1;
    maximumActiveCommands = Math.max(maximumActiveCommands, activeCommands);
    await new Promise((resolve) => setTimeout(resolve, 5));
    activeCommands -= 1;

    if (args[0] === 'log') {
      return { stdout: 'subject\0' + '2026-01-01T00:00:00Z', stderr: '' };
    }
    if (args[0] === 'rev-list') {
      return { stdout: '0 1', stderr: '' };
    }
    return { stdout: '', stderr: '' };
  };

  const result = await listWorktrees(
    { projectPath: '/workspace/repo-0' },
    { runGit, getProjectByPath: () => null },
  );

  assert.equal(maximumActiveCommands <= 12, true);
  assert.deepEqual(result.worktrees.map((worktree) => worktree.path.replace(/\\/g, '/')),
    Array.from({ length: entryCount }, (_, index) => `/workspace/repo-${index}`));
});
