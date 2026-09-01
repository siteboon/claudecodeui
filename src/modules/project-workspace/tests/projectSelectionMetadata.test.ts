import assert from 'node:assert/strict';

import { test } from 'vitest';

import type { Project } from '@/shared/types';
import { mergeProjectSelectionMetadata } from '@/modules/project-workspace/utils/projectSelectionMetadata';

const selectedProject: Project = {
  projectId: 'project-1',
  displayName: 'Project One',
  fullPath: '/workspace/project-one',
  path: '/workspace/project-one',
  isStarred: false,
  sessions: [{ id: 'session-1', summary: 'Original session' }],
  sessionMeta: { total: 1, hasMore: false },
  taskmaster: { hasTaskmaster: true, status: 'ready' },
};

test('keeps selected-project identity when only sidebar sessions change', () => {
  const sidebarProject: Project = {
    ...selectedProject,
    sessions: [{ id: 'session-2', summary: 'New sidebar session' }],
    sessionMeta: { total: 2, hasMore: false },
  };
  const result = mergeProjectSelectionMetadata(selectedProject, sidebarProject);

  assert.equal(result, selectedProject);
});

test('updates workspace metadata without replacing selected-project sessions', () => {
  const result = mergeProjectSelectionMetadata(selectedProject, {
    ...selectedProject,
    displayName: 'Renamed Project',
    isStarred: true,
  });

  assert.notEqual(result, selectedProject);
  assert.equal(result.displayName, 'Renamed Project');
  assert.equal(result.isStarred, true);
  assert.equal(result.sessions, selectedProject.sessions);
  assert.equal(result.sessionMeta, selectedProject.sessionMeta);
});

test('keeps taskmaster metadata when a realtime project snapshot omits it', () => {
  const result = mergeProjectSelectionMetadata(selectedProject, {
    projectId: selectedProject.projectId,
    displayName: selectedProject.displayName,
    fullPath: selectedProject.fullPath,
    path: selectedProject.path,
    isStarred: selectedProject.isStarred,
  });

  assert.equal(result, selectedProject);
  assert.equal(result.taskmaster, selectedProject.taskmaster);
});
