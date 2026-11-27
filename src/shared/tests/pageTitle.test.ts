import assert from 'node:assert/strict';

import { afterEach, test } from 'vitest';

import type { Project, ProjectSession } from '@/shared/types';
import {
  getPageTitle,
  setPendingAttentionTitleState,
  showAttentionTitleIndicator,
  showCompletionTitleIndicator,
} from '@/shared/utils';

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

const restoreVisibilityDescriptor = Object.getOwnPropertyDescriptor(document, 'visibilityState');

const setTabBackgrounded = (backgrounded: boolean) => {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => (backgrounded ? 'hidden' : 'visible'),
  });
};

afterEach(() => {
  setPendingAttentionTitleState(false, { clearActiveIndicator: true });
  if (restoreVisibilityDescriptor) {
    Object.defineProperty(document, 'visibilityState', restoreVisibilityDescriptor);
  } else {
    delete (document as { visibilityState?: DocumentVisibilityState }).visibilityState;
  }
  document.title = '';
});

test('background completion sets [Done] when no request is waiting, and yields to pending attention', () => {
  setTabBackgrounded(true);
  document.title = 'Session B';

  showCompletionTitleIndicator();
  assert.equal(document.title, '[Done] Session B');

  showAttentionTitleIndicator();
  assert.equal(document.title, '[Action required] Session B');

  // Another subscribed session finishes while Session B still waits: keep [Action required].
  setPendingAttentionTitleState(true);
  showCompletionTitleIndicator();
  assert.equal(document.title, '[Action required] Session B');

  // Even if the title synced without its prefix while a request still waits, do not report [Done].
  document.title = 'Session B';
  showCompletionTitleIndicator();
  assert.equal(document.title, '[Action required] Session B');

  // Once the waiting request clears, normal completion indicators resume.
  setPendingAttentionTitleState(false, { clearActiveIndicator: true });
  assert.equal(document.title, 'Session B');

  showCompletionTitleIndicator();
  assert.equal(document.title, '[Done] Session B');
});
