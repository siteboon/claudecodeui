/**
 * Real integration test for KiroSessionSynchronizer.
 *
 * Spins up an isolated SQLite DB + tmp ~/.kiro/sessions/cli/ tree, drops
 * fixture {.json,.jsonl} pairs onto disk, runs `synchronizeFile`, and asserts
 * the regression fix from code review:
 *
 *   - When the existing DB row has a user-set `custom_name`, the next
 *     synchronizeFile pass MUST NOT overwrite it with the sidecar `title`.
 *     (Bug regression scenario: user renamed a session via the UI; next
 *     synchronization round-trip wiped the rename.)
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const ORIGINAL_HOME = process.env.HOME;
const ORIGINAL_DB = process.env.DATABASE_PATH;

let tempHome: string;
let tempDbDir: string;

before(async () => {
  tempHome = await mkdtemp(path.join(tmpdir(), 'kiro-sync-home-'));
  tempDbDir = await mkdtemp(path.join(tmpdir(), 'kiro-sync-db-'));
  process.env.HOME = tempHome;
  process.env.USERPROFILE = tempHome;
  process.env.DATABASE_PATH = path.join(tempDbDir, 'auth.db');

  // mkdir the kiro session tree the synchronizer expects
  await mkdir(path.join(tempHome, '.kiro', 'sessions', 'cli'), { recursive: true });
});

after(async () => {
  // Best-effort restore + cleanup
  if (ORIGINAL_HOME !== undefined) {
    process.env.HOME = ORIGINAL_HOME;
    process.env.USERPROFILE = ORIGINAL_HOME;
  } else {
    delete process.env.HOME;
  }
  if (ORIGINAL_DB !== undefined) {
    process.env.DATABASE_PATH = ORIGINAL_DB;
  } else {
    delete process.env.DATABASE_PATH;
  }
  if (tempHome) await rm(tempHome, { recursive: true, force: true });
  if (tempDbDir) await rm(tempDbDir, { recursive: true, force: true });
});

describe('KiroSessionSynchronizer', () => {
  it('preserves a user-set custom_name across re-synchronization (regression)', async () => {
    // Lazy-import so the env overrides above are in effect when modules
    // capture homedir() / DATABASE_PATH.
    const { closeConnection, initializeDatabase, sessionsDb } = await import('@/modules/database/index.js');
    const { KiroSessionSynchronizer } = await import('@/modules/providers/list/kiro/kiro-session-synchronizer.provider.js');

    closeConnection();
    await initializeDatabase();

    const sessionId = 'aaaa1111-bbbb-cccc-dddd-000000000001';
    const sidecarPath = path.join(tempHome, '.kiro', 'sessions', 'cli', `${sessionId}.json`);
    const jsonlPath = path.join(tempHome, '.kiro', 'sessions', 'cli', `${sessionId}.jsonl`);

    await writeFile(
      sidecarPath,
      JSON.stringify({
        session_id: sessionId,
        cwd: '/tmp',
        created_at: '2026-05-12T00:00:00.000Z',
        updated_at: '2026-05-12T00:00:30.000Z',
        title: 'original kiro-derived title',
      }),
    );
    await writeFile(jsonlPath, '{"version":"v1","kind":"Prompt","data":{"message_id":"p1","content":[{"kind":"text","data":"hi"}]}}\n');

    const sync = new KiroSessionSynchronizer();

    // First sync: no DB row exists → adopt the sidecar title.
    await sync.synchronizeFile(jsonlPath);
    let row = sessionsDb.getSessionById(sessionId);
    assert.ok(row, 'session should be indexed after first sync');
    assert.equal(row.custom_name, 'original kiro-derived title');
    assert.equal(row.provider, 'kiro');
    assert.equal(row.project_path, '/tmp');

    // User renames the session via the UI.
    sessionsDb.updateSessionCustomName(sessionId, 'My Important Refactor');
    row = sessionsDb.getSessionById(sessionId);
    assert.equal(row?.custom_name, 'My Important Refactor');

    // Second sync (e.g. a watcher event after the user typed another message).
    // The sidecar `title` is still "original kiro-derived title", but the user's
    // custom name MUST survive.
    await sync.synchronizeFile(jsonlPath);
    row = sessionsDb.getSessionById(sessionId);
    assert.equal(
      row?.custom_name,
      'My Important Refactor',
      'user-set custom_name must not be wiped by re-synchronization',
    );

    closeConnection();
  });

  it('skips files whose sidecar JSON is missing', async () => {
    const { closeConnection, initializeDatabase, sessionsDb } = await import('@/modules/database/index.js');
    const { KiroSessionSynchronizer } = await import('@/modules/providers/list/kiro/kiro-session-synchronizer.provider.js');

    closeConnection();
    await initializeDatabase();

    const sessionId = 'no-sidecar-' + Date.now();
    const jsonlPath = path.join(tempHome, '.kiro', 'sessions', 'cli', `${sessionId}.jsonl`);
    // jsonl exists, sidecar does NOT (race window when ACP creates jsonl first)
    await writeFile(jsonlPath, '{"version":"v1","kind":"Prompt","data":{"content":[]}}\n');

    const sync = new KiroSessionSynchronizer();
    const result = await sync.synchronizeFile(jsonlPath);

    assert.equal(result, null, 'must return null when sidecar is missing');
    const row = sessionsDb.getSessionById(sessionId);
    assert.ok(row == null, 'must not insert a row without project_path');

    closeConnection();
  });

  it('returns null for non-jsonl paths', async () => {
    const { KiroSessionSynchronizer } = await import('@/modules/providers/list/kiro/kiro-session-synchronizer.provider.js');
    const sync = new KiroSessionSynchronizer();
    const result = await sync.synchronizeFile('/some/path/foo.json');
    assert.equal(result, null);
  });
});
