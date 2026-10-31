import assert from 'node:assert/strict';

import { test } from 'vitest';

import { filterProjects } from '@/modules/sidebar/utils/sidebarProjectFormatting';
import type { Project } from '@/shared/types';

/**
 * The Projects tab filter used to look at project names and paths only, so a
 * session could not be found by its title. These cover the session half: a
 * project is kept, narrowed to the sessions that match, when a title does.
 */

const PROJECTS: Project[] = [
  {
    projectId: 'p1',
    displayName: 'git',
    fullPath: '/home/me/git',
    sessions: [
      { id: 's1', summary: 'I need a wos-19.20' },
      { id: 's2', summary: 'ODM images for QE' },
      { id: 's3', name: 'spurs AP reboot' },
    ],
  },
  {
    projectId: 'p2',
    displayName: 'odm-tools',
    fullPath: '/home/me/odm-tools',
    sessions: [{ id: 's4', summary: 'unrelated' }],
  },
];

test('a session title match keeps the project, narrowed to the matching sessions', () => {
  const [project] = filterProjects([PROJECTS[0]], 'wos-19');
  assert.equal(project.projectId, 'p1');
  assert.deepEqual(project.sessions?.map((session) => session.id), ['s1']);
  assert.equal(project.sessionsMatchedFilter, true);
});

test('a project name match keeps every session', () => {
  const [project] = filterProjects([PROJECTS[1]], 'odm');
  assert.equal(project.sessions?.length, 1);
  assert.equal(project.sessionsMatchedFilter, undefined);
});

test('words match in any order and against the session name fallback', () => {
  assert.deepEqual(filterProjects(PROJECTS, 'qe images')[0].sessions?.map((session) => session.id), ['s2']);
  assert.deepEqual(filterProjects(PROJECTS, 'reboot spurs')[0].sessions?.map((session) => session.id), ['s3']);
});

test('projects with neither a name nor a session match are dropped', () => {
  assert.deepEqual(filterProjects(PROJECTS, 'nothing here'), []);
});

test('an empty filter returns the projects untouched', () => {
  assert.equal(filterProjects(PROJECTS, '  '), PROJECTS);
});
