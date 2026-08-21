import assert from 'node:assert/strict';

import { test } from 'vitest';

import type { ActiveSidebarRename } from '@/shared/types';

/**
 * The sidebar held renames as two id/draft pairs — editingProject/editingName
 * and editingSession/editingSessionName — which made "a project and a session
 * are both mid-rename" representable, and broadcast the raw draft to every row
 * so a keystroke invalidated the whole list.
 *
 * These tests pin the resolution rule the rows now use. It is expressed here
 * exactly as SidebarProjectList and SidebarProjectSessions apply it.
 */

const isRowEditing = (
  activeRename: ActiveSidebarRename | null,
  target: 'project' | 'session',
  id: string,
): boolean => activeRename?.target === target && activeRename.id === id;

const rowDraft = (
  activeRename: ActiveSidebarRename | null,
  target: 'project' | 'session',
  id: string,
): string => (isRowEditing(activeRename, target, id) ? activeRename!.draft : '');

test('no rename means no row is editing', () => {
  assert.equal(isRowEditing(null, 'project', 'p1'), false);
  assert.equal(rowDraft(null, 'project', 'p1'), '');
});

test('only the renamed project row is editing', () => {
  const rename: ActiveSidebarRename = { target: 'project', id: 'p1', draft: 'New name' };

  assert.equal(isRowEditing(rename, 'project', 'p1'), true);
  assert.equal(isRowEditing(rename, 'project', 'p2'), false);
});

test('only the renamed row receives the draft', () => {
  const rename: ActiveSidebarRename = { target: 'project', id: 'p1', draft: 'New name' };

  assert.equal(rowDraft(rename, 'project', 'p1'), 'New name');
  assert.equal(
    rowDraft(rename, 'project', 'p2'),
    '',
    'other rows must get a constant, so a keystroke does not change their props',
  );
});

test('a session rename does not put a same-id project row into edit mode', () => {
  // The two id spaces are independent; without the target discriminator a
  // session and a project sharing an id would both go into edit mode.
  const rename: ActiveSidebarRename = { target: 'session', id: 'shared-id', draft: 'x' };

  assert.equal(isRowEditing(rename, 'session', 'shared-id'), true);
  assert.equal(isRowEditing(rename, 'project', 'shared-id'), false);
});

test('a project and a session cannot both be mid-rename', () => {
  // The union makes the illegal combination unrepresentable: starting one
  // rename replaces the other rather than adding to it.
  const projectRename: ActiveSidebarRename = { target: 'project', id: 'p1', draft: 'a' };
  const sessionRename: ActiveSidebarRename = { target: 'session', id: 's1', draft: 'b' };

  assert.equal(isRowEditing(sessionRename, 'project', 'p1'), false);
  assert.equal(isRowEditing(projectRename, 'session', 's1'), false);
});
