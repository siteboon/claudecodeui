import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createProjectsSnapshot,
} from '@/modules/projects/index.js';
import { ProjectListItem, ProjectsSnapshot } from '@/modules/projects/services/projects.service.js';

test('createProjectsSnapshot returns an object matching the predefined snapshot type', () => {
  const projects: ProjectListItem[] = [
    {
      projectId: 'project-1',
      path: '/tmp/project-1',
      displayName: 'project-1',
      fullPath: '/tmp/project-1',
      sessions: [],
      cursorSessions: [],
      codexSessions: [],
      geminiSessions: [],
      sessionMeta: {
        hasMore: false,
        total: 0,
      },
    },
  ];

  const snapshot: ProjectsSnapshot = createProjectsSnapshot(projects);

  assert.equal(typeof snapshot.generatedAt, 'string');
  assert.equal(snapshot.projectCount, 1);
  assert.deepEqual(snapshot.projects, projects);
});
