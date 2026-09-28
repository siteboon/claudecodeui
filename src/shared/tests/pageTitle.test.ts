import assert from 'node:assert/strict';

import { test } from 'vitest';

import type { Project, ProjectSession } from '@/shared/types';
import { getPageTitle } from '@/shared/utils';

const project: Project = {
  projectId: 'project-1',
  displayName: 'My Project',
  fullPath: '/projects/my-project',
};

test('uses the selected session summary as the page title', () => {
  const session: ProjectSession = {
    id: 'session-1',
    summary: 'Fix browser tab title',
    __provider: 'claude',
  };

  assert.equal(getPageTitle(project, session), 'Fix browser tab title');
});

test('uses the selected Cursor session name as the page title', () => {
  const session: ProjectSession = {
    id: 'session-1',
    name: 'Cursor session name',
    __provider: 'cursor',
  };

  assert.equal(getPageTitle(project, session), 'Cursor session name');
});

test('prefers the persisted summary of a Cursor session, as the sessions API returns it', () => {
  // The sessions API carries every provider's custom name as `summary` and never
  // sets `name`, so a renamed Cursor session must not fall through to the placeholder.
  const session: ProjectSession = {
    id: 'session-1',
    summary: 'Cursor session renamed',
    __provider: 'cursor',
  };

  assert.equal(getPageTitle(project, session), 'Cursor session renamed');
  assert.equal(getPageTitle(project, { id: 'session-2', summary: '', __provider: 'cursor' }), 'Untitled Session');
});

test('falls back to the project title when no session is selected', () => {
  assert.equal(getPageTitle(project, null), 'My Project - CloudCLI UI');
});

test('falls back to the app title when no project or session is selected', () => {
  assert.equal(getPageTitle(null, null), 'CloudCLI UI');
});
