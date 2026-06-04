import assert from 'node:assert/strict';
import test from 'node:test';

import { projectsDb } from '@/modules/database/index.js';
import { applyLegacyStarredProjectIds, toggleProjectStar } from '@/modules/projects/services/project-star.service.js';
import { AppError } from '@/shared/utils.js';

type ProjectRow = {
  project_id: string;
  project_path: string;
  custom_project_name: string | null;
  isStarred: number;
  isArchived: number;
};

test('toggleProjectStar throws when projectId is missing', () => {
  assert.throws(
    () => toggleProjectStar('   '),
    (error: unknown) =>
      error instanceof AppError
      && error.code === 'PROJECT_ID_REQUIRED'
      && error.statusCode === 400,
  );
});

test('toggleProjectStar throws when project does not exist', () => {
  const originalGetProjectById = projectsDb.getProjectById;
  try {
    projectsDb.getProjectById = () => null;
    assert.throws(
      () => toggleProjectStar('project-1'),
      (error: unknown) =>
        error instanceof AppError
        && error.code === 'PROJECT_NOT_FOUND'
        && error.statusCode === 404,
    );
  } finally {
    projectsDb.getProjectById = originalGetProjectById;
  }
});

test('toggleProjectStar flips star state and persists it', () => {
  const originalGetProjectById = projectsDb.getProjectById;
  const originalUpdateProjectIsStarredById = projectsDb.updateProjectIsStarredById;

  let capturedProjectId = '';
  let capturedState = false;

  try {
    projectsDb.getProjectById = () =>
      ({
        project_id: 'project-1',
        project_path: '/workspace/project-1',
        custom_project_name: 'project-1',
        isStarred: 0,
        isArchived: 0,
      }) as ProjectRow;
    projectsDb.updateProjectIsStarredById = (projectId: string, isStarred: boolean) => {
      capturedProjectId = projectId;
      capturedState = isStarred;
    };

    const result = toggleProjectStar('project-1');

    assert.equal(result.isStarred, true);
    assert.equal(capturedProjectId, 'project-1');
    assert.equal(capturedState, true);
  } finally {
    projectsDb.getProjectById = originalGetProjectById;
    projectsDb.updateProjectIsStarredById = originalUpdateProjectIsStarredById;
  }
});

test('applyLegacyStarredProjectIds stars only valid, unstarred projects', () => {
  const originalGetProjectById = projectsDb.getProjectById;
  const originalUpdateProjectIsStarredById = projectsDb.updateProjectIsStarredById;

  const updatedProjectIds: string[] = [];

  try {
    projectsDb.getProjectById = (projectId: string) => {
      if (projectId === 'project-a') {
        return {
          project_id: 'project-a',
          project_path: '/workspace/project-a',
          custom_project_name: 'A',
          isStarred: 0,
          isArchived: 0,
        } as ProjectRow;
      }

      if (projectId === 'project-b') {
        return {
          project_id: 'project-b',
          project_path: '/workspace/project-b',
          custom_project_name: 'B',
          isStarred: 1,
          isArchived: 0,
        } as ProjectRow;
      }

      return null;
    };
    projectsDb.updateProjectIsStarredById = (projectId: string) => {
      updatedProjectIds.push(projectId);
    };

    const result = applyLegacyStarredProjectIds([
      'project-a',
      'project-b',
      'missing-project',
      'project-a',
      '',
      '   ',
    ]);

    assert.equal(result.updated, 1);
    assert.deepEqual(updatedProjectIds, ['project-a']);
  } finally {
    projectsDb.getProjectById = originalGetProjectById;
    projectsDb.updateProjectIsStarredById = originalUpdateProjectIsStarredById;
  }
});
