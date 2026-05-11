import assert from 'node:assert/strict';
import test from 'node:test';

import { createProject } from '@/modules/projects/services/project-management.service.js';
import { AppError } from '@/shared/utils.js';

const projectRow = {
  project_id: 'project-1',
  project_path: '/workspace/my-project',
  custom_project_name: 'my-project',
  isStarred: 0,
  isArchived: 0,
};

test('createProject throws when project path is missing', async () => {
  await assert.rejects(
    async () => createProject({ projectPath: '' }),
    (error: unknown) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.code, 'PROJECT_PATH_REQUIRED');
      assert.equal(error.statusCode, 400);
      return true;
    },
  );
});

test('createProject throws when path validation fails', async () => {
  await assert.rejects(
    async () =>
      createProject(
        { projectPath: '/invalid/path' },
        {
          validatePath: async () => ({ valid: false, error: 'blocked path' }),
          ensureWorkspaceDirectory: async () => undefined,
          persistProjectPath: () => ({ outcome: 'created', project: projectRow }),
          getProjectByPath: () => projectRow,
        },
      ),
    (error: unknown) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.code, 'INVALID_PROJECT_PATH');
      assert.equal(error.statusCode, 400);
      assert.equal(error.details, 'blocked path');
      return true;
    },
  );
});

test('createProject throws conflict when active project path already exists', async () => {
  await assert.rejects(
    async () =>
      createProject(
        { projectPath: '/workspace/my-project' },
        {
          validatePath: async () => ({ valid: true, resolvedPath: '/workspace/my-project' }),
          ensureWorkspaceDirectory: async () => undefined,
          persistProjectPath: () => ({ outcome: 'active_conflict', project: projectRow }),
          getProjectByPath: () => projectRow,
        },
      ),
    (error: unknown) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.code, 'PROJECT_ALREADY_EXISTS');
      assert.equal(error.statusCode, 409);
      assert.equal(error.details, 'Project path already exists: /workspace/my-project');
      return true;
    },
  );
});

test('createProject falls back to directory name when custom name is not provided', async () => {
  let capturedCustomName: string | null = null;

  const result = await createProject(
    { projectPath: '/workspace/my-project', customName: '' },
    {
      validatePath: async () => ({ valid: true, resolvedPath: '/workspace/my-project' }),
      ensureWorkspaceDirectory: async () => undefined,
      persistProjectPath: (_projectPath, customName) => {
        capturedCustomName = customName;
        return {
          outcome: 'created',
          project: {
            ...projectRow,
            custom_project_name: customName,
          },
        };
      },
      getProjectByPath: () => projectRow,
    },
  );

  assert.equal(capturedCustomName, 'my-project');
  assert.equal(result.outcome, 'created');
  assert.equal(result.project.displayName, 'my-project');
});

test('createProject returns archived reuse outcome when archived row is reused', async () => {
  const result = await createProject(
    { projectPath: '/workspace/my-project' },
    {
      validatePath: async () => ({ valid: true, resolvedPath: '/workspace/my-project' }),
      ensureWorkspaceDirectory: async () => undefined,
      persistProjectPath: () => ({
        outcome: 'reactivated_archived',
        project: {
          ...projectRow,
          isArchived: 1,
        },
      }),
      getProjectByPath: () => projectRow,
    },
  );

  assert.equal(result.outcome, 'reactivated_archived');
  assert.equal(result.project.isArchived, true);
});
