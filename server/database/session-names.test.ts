import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Point at a throwaway on-disk sqlite file BEFORE the db module initializes
// its connection. better-sqlite3 will create the file if it doesn't exist.
const TEMP_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ccui-session-names-'));
process.env.DATABASE_PATH = path.join(TEMP_DB_DIR, 'auth.db');

const { applyCustomSessionNames, sessionNamesDb, initializeDatabase } = await import('./db.js');

// Ensure the SESSION_NAMES table exists (initializeDatabase runs migrations).
initializeDatabase();

test('applyCustomSessionNames: populates customName and keeps summary overwrite as compat', () => {
  const stickyId = 'session-abc';
  const untouchedId = 'session-xyz';

  sessionNamesDb.setName(stickyId, 'claude', 'User pinned');

  const sessions: Array<{ id: string; summary?: string; customName?: string | null }> = [
    { id: stickyId, summary: 'CLI auto-summary from last send' },
    { id: untouchedId, summary: 'never renamed' },
  ];

  applyCustomSessionNames(sessions, 'claude');

  const sticky = sessions.find((s) => s.id === stickyId)!;
  assert.equal(sticky.customName, 'User pinned', 'customName should be populated from DB');
  assert.equal(sticky.summary, 'User pinned', 'summary stays overwritten as compat fallback');

  const untouched = sessions.find((s) => s.id === untouchedId)!;
  assert.equal(untouched.customName, undefined, 'session without a DB row has no customName');
  assert.equal(untouched.summary, 'never renamed', 'session without a DB row keeps its summary');

  // Cleanup so reruns of this test aren't order-sensitive.
  sessionNamesDb.deleteName(stickyId, 'claude');
});

test('applyCustomSessionNames: is scoped per-provider', () => {
  const id = 'shared-id';
  sessionNamesDb.setName(id, 'claude', 'Claude name');
  sessionNamesDb.setName(id, 'cursor', 'Cursor name');

  const claudeSessions = [{ id, summary: 'claude-summary' }];
  applyCustomSessionNames(claudeSessions, 'claude');
  assert.equal((claudeSessions[0] as any).customName, 'Claude name');

  const cursorSessions = [{ id, summary: 'cursor-summary' }];
  applyCustomSessionNames(cursorSessions, 'cursor');
  assert.equal((cursorSessions[0] as any).customName, 'Cursor name');

  sessionNamesDb.deleteName(id, 'claude');
  sessionNamesDb.deleteName(id, 'cursor');
});

test('applyCustomSessionNames: no-op on empty list', () => {
  // Should not throw.
  applyCustomSessionNames([], 'claude');
  applyCustomSessionNames(undefined as any, 'claude');
});
