import assert from 'node:assert/strict';
import test from 'node:test';

import { createAndOpenWorktree } from '@/modules/worktrees/services/worktree-create-and-open.service.js';
import type { RemoveWorktreeInput } from '@/shared/types.js';

const input = {
  projectPath: '/workspace/repo',
  branch: 'feature/login',
};

test('createAndOpenWorktree returns the registered project', async () => {
  const result = await createAndOpenWorktree(input, {
    createWorktree: async () => ({
      worktreePath: '/workspace/repo-worktrees/feature-login',
      branch: 'feature/login',
      createdBranch: true,
    }),
    openWorktree: async ({ worktreePath }) => ({
      projectId: 'project-2',
      path: worktreePath,
      fullPath: worktreePath,
      displayName: 'feature/login',
      isStarred: false,
      sessions: [],
      sessionMeta: { hasMore: false, total: 0 },
    }),
    removeWorktree: async () => {
      throw new Error('unexpected cleanup');
    },
  });

  assert.equal(result.project.projectId, 'project-2');
});

test('createAndOpenWorktree compensates registration failure without deleting an existing branch', async () => {
  const removals: RemoveWorktreeInput[] = [];
  const registrationError = new Error('registration failed');

  await assert.rejects(
    createAndOpenWorktree(input, {
      createWorktree: async () => ({
        worktreePath: '/workspace/repo-worktrees/feature-login',
        branch: 'feature/login',
        createdBranch: false,
      }),
      openWorktree: async () => { throw registrationError; },
      removeWorktree: async (removeInput) => {
        removals.push(removeInput);
        return {
          removedPath: removeInput.worktreePath,
          branch: 'feature/login',
          branchDeleted: false,
          archivedProjectId: null,
          archivalError: null,
        };
      },
    }),
    registrationError,
  );

  assert.deepEqual(removals, [{
    projectPath: input.projectPath,
    worktreePath: '/workspace/repo-worktrees/feature-login',
    force: true,
    deleteBranch: false,
  }]);
});
