import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getProjectTaskMaster,
  getProjectTaskMasterById,
} from '@/modules/projects/services/projects-has-taskmaster.service.js';
import { AppError } from '@/shared/utils.js';

test('getProjectTaskMasterById returns null when project path is missing', async () => {
  const result = await getProjectTaskMasterById('project-1', {
    resolveProjectPathById: () => null,
    detectTaskMasterFolder: async () => {
      throw new Error('detectTaskMasterFolder should not be called when path is missing');
    },
  });

  assert.equal(result, null);
});

test('getProjectTaskMasterById returns configured status when taskmaster exists with essential files', async () => {
  const result = await getProjectTaskMasterById('project-1', {
    resolveProjectPathById: () => '/workspace/project-1',
    detectTaskMasterFolder: async () => ({
      hasTaskmaster: true,
      hasEssentialFiles: true,
      metadata: {
        taskCount: 3,
        subtaskCount: 0,
        completed: 1,
        pending: 2,
        inProgress: 0,
        review: 0,
        completionPercentage: 33,
        lastModified: '2026-01-01T00:00:00.000Z',
      },
    }),
  });

  assert.ok(result);
  assert.equal(result.projectId, 'project-1');
  assert.equal(result.projectPath, '/workspace/project-1');
  assert.equal(result.taskmaster.hasTaskmaster, true);
  assert.equal(result.taskmaster.hasEssentialFiles, true);
  assert.equal(result.taskmaster.status, 'configured');
  assert.deepEqual(result.taskmaster.metadata, {
    taskCount: 3,
    subtaskCount: 0,
    completed: 1,
    pending: 2,
    inProgress: 0,
    review: 0,
    completionPercentage: 33,
    lastModified: '2026-01-01T00:00:00.000Z',
  });
});

test('getProjectTaskMasterById returns not-configured status when taskmaster is missing', async () => {
  const result = await getProjectTaskMasterById('project-1', {
    resolveProjectPathById: () => '/workspace/project-1',
    detectTaskMasterFolder: async () => ({
      hasTaskmaster: false,
    }),
  });

  assert.ok(result);
  assert.equal(result.taskmaster.hasTaskmaster, false);
  assert.equal(result.taskmaster.hasEssentialFiles, false);
  assert.equal(result.taskmaster.status, 'not-configured');
  assert.equal(result.taskmaster.metadata, null);
});

test('getProjectTaskMaster throws when project id is missing', async () => {
  await assert.rejects(
    async () =>
      getProjectTaskMaster('', async () => ({
        projectId: 'project-1',
        projectPath: '/workspace/project-1',
        taskmaster: {
          hasTaskmaster: true,
          hasEssentialFiles: true,
          metadata: null,
          status: 'configured',
        },
      })),
    (error: unknown) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.code, 'PROJECT_ID_REQUIRED');
      assert.equal(error.statusCode, 400);
      return true;
    },
  );
});

test('getProjectTaskMaster throws when project does not exist', async () => {
  await assert.rejects(
    async () => getProjectTaskMaster('project-that-does-not-exist', async () => null),
    (error: unknown) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.code, 'PROJECT_NOT_FOUND');
      assert.equal(error.statusCode, 404);
      return true;
    },
  );
});
