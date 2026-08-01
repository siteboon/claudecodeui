import assert from 'node:assert/strict';
import test from 'node:test';

import { openWorktreeAsProject } from '@/modules/worktrees/services/worktree-open.service.js';
import type { GitCommandResult, ProjectRepositoryRow } from '@/shared/types.js';
import { normalizeProjectPath } from '@/shared/utils.js';

const MAIN_PATH = normalizeProjectPath('/home/user/repo');
const WORKTREE_PATH = normalizeProjectPath('/home/user/repo-worktrees/feature-login');
const PORCELAIN = [
  'worktree /home/user/repo',
  'HEAD 1111111111111111111111111111111111111111',
  'branch refs/heads/main',
  '',
  'worktree /home/user/repo-worktrees/feature-login',
  'HEAD 2222222222222222222222222222222222222222',
  'branch refs/heads/feature/login',
  '',
].join('\n');

function createFakeRunner() {
  return async (args: string[]): Promise<GitCommandResult> => {
    if (args[0] === 'worktree' && args[1] === 'list') {
      return { stdout: PORCELAIN, stderr: '' };
    }

    return { stdout: '', stderr: '' };
  };
}

function createProjectRow(isArchived = false): ProjectRepositoryRow {
  return {
    project_id: 'project-1',
    project_path: WORKTREE_PATH,
    custom_project_name: 'repo · feature/login',
    isStarred: 0,
    isArchived: isArchived ? 1 : 0,
  };
}

test('openWorktreeAsProject returns an already-active linked project', async () => {
  const projectRow = createProjectRow();
  let createCalls = 0;
  let restoreCalls = 0;

  const result = await openWorktreeAsProject(
    { projectPath: MAIN_PATH, worktreePath: WORKTREE_PATH },
    {
      runGit: createFakeRunner(),
      projects: {
        getProjectByPath: () => projectRow,
        createProject: async () => {
          createCalls += 1;
          return { outcome: 'created' as const, project: { projectId: 'unexpected' } };
        },
        restoreProject: () => {
          restoreCalls += 1;
        },
      },
    },
  );

  assert.equal(result.projectId, 'project-1');
  assert.equal(result.path, WORKTREE_PATH);
  assert.equal(createCalls, 0);
  assert.equal(restoreCalls, 0);
});

test('openWorktreeAsProject restores an archived linked project', async () => {
  const projectRow = createProjectRow(true);
  const restoredProjectIds: string[] = [];

  const result = await openWorktreeAsProject(
    { projectPath: MAIN_PATH, worktreePath: WORKTREE_PATH },
    {
      runGit: createFakeRunner(),
      projects: {
        getProjectByPath: () => projectRow,
        createProject: async () => ({
          outcome: 'created' as const,
          project: { projectId: 'unexpected' },
        }),
        restoreProject: (projectId) => {
          restoredProjectIds.push(projectId);
          projectRow.isArchived = 0;
        },
      },
    },
  );

  assert.equal(result.projectId, 'project-1');
  assert.deepEqual(restoredProjectIds, ['project-1']);
});

test('openWorktreeAsProject registers a worktree that has no project record', async () => {
  let projectRow: ProjectRepositoryRow | null = null;
  const createInputs: Array<{ projectPath: string; customName: string }> = [];

  const result = await openWorktreeAsProject(
    { projectPath: MAIN_PATH, worktreePath: WORKTREE_PATH },
    {
      runGit: createFakeRunner(),
      projects: {
        getProjectByPath: () => projectRow,
        createProject: async (input) => {
          createInputs.push(input);
          projectRow = createProjectRow();
          return { outcome: 'created' as const, project: { projectId: 'project-1' } };
        },
        restoreProject: () => {
          throw new Error('restoreProject should not be called for a new project');
        },
      },
    },
  );

  assert.equal(result.projectId, 'project-1');
  assert.deepEqual(createInputs, [{
    projectPath: WORKTREE_PATH,
    customName: 'repo · feature/login',
  }]);
});
