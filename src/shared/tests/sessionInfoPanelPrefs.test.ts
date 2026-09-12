import assert from 'node:assert/strict';

import { beforeEach, test } from 'vitest';

import {
  readStoredSessionInfoPanelPrefs,
  withSectionCollapsed,
} from '@/shared/sessionInfoPanelPrefs';
import { writeUserPreference, resetUserPreferences } from '@/shared/userSettings';

beforeEach(() => {
  localStorage.clear();
  resetUserPreferences();
});

test('a fresh install opens closed with nothing collapsed', () => {
  assert.deepEqual(readStoredSessionInfoPanelPrefs(), { open: false, collapsedSections: {} });
});

test('the stored blob round-trips through the preference store', () => {
  writeUserPreference('sessionInfoPanel', { open: true, collapsedSections: { tasks: true, mcp: false } });

  const prefs = readStoredSessionInfoPanelPrefs();
  assert.equal(prefs.open, true);
  assert.deepEqual(prefs.collapsedSections, { tasks: true });
});

test('junk is filtered, strings coerced, unknown sections dropped', () => {
  writeUserPreference('sessionInfoPanel', {
    open: 'true',
    collapsedSections: { tasks: 'true', bogus: true, mcp: false, context: 42 },
  });

  const prefs = readStoredSessionInfoPanelPrefs();
  assert.equal(prefs.open, true);
  assert.deepEqual(prefs.collapsedSections, { tasks: true });
});

test('withSectionCollapsed is immutable and idempotent', () => {
  const start = readStoredSessionInfoPanelPrefs();

  const closed = withSectionCollapsed(start, 'tasks', true);
  assert.deepEqual(start.collapsedSections, {});
  assert.deepEqual(closed.collapsedSections, { tasks: true });

  // Re-collapsing an already-collapsed section returns the same object.
  assert.equal(withSectionCollapsed(closed, 'tasks', true), closed);

  // Uncollapsing removes the key entirely rather than storing false.
  const reopened = withSectionCollapsed(closed, 'tasks', false);
  assert.deepEqual(reopened.collapsedSections, {});
  assert.equal('tasks' in reopened.collapsedSections, false);
});
