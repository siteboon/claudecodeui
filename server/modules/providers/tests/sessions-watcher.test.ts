import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, initializeDatabase, sessionsDb } from '@/modules/database/index.js';
import {
  reconcileMissingSessionFiles,
  removeSessionForUnlinkedFile,
  unarchiveSessionForRealActivity,
} from '@/modules/providers/services/sessions-watcher.service.js';

async function withIsolatedDatabase(runTest: () => void | Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'sessions-watcher-db-'));
  const databasePath = path.join(tempDirectory, 'auth.db');

  closeConnection();
  process.env.DATABASE_PATH = databasePath;
  await initializeDatabase();

  try {
    await runTest();
  } finally {
    closeConnection();
    if (previousDatabasePath === undefined) {
      delete process.env.DATABASE_PATH;
    } else {
      process.env.DATABASE_PATH = previousDatabasePath;
    }
    await rm(tempDirectory, { recursive: true, force: true });
  }
}

async function withTempDir(prefix: string, runTest: (dir: string) => Promise<void>): Promise<void> {
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), prefix));
  try {
    await runTest(tempDirectory);
  } finally {
    await rm(tempDirectory, { recursive: true, force: true });
  }
}

test('removeSessionForUnlinkedFile deletes the session whose jsonl_path was removed', async () => {
  await withIsolatedDatabase(async () => {
    sessionsDb.createSession('claude-1', 'claude', '/workspace/demo-project', 'Session One', undefined, undefined, '/tmp/claude-1.jsonl');

    const result = removeSessionForUnlinkedFile('claude', '/tmp/claude-1.jsonl');

    assert.deepEqual(result, { sessionId: 'claude-1', provider: 'claude' });
    assert.equal(sessionsDb.getSessionById('claude-1'), null);
  });
});

test('removeSessionForUnlinkedFile deletes a previously-archived row (disk is the source of truth)', async () => {
  await withIsolatedDatabase(async () => {
    sessionsDb.createSession('claude-archived', 'claude', '/workspace/demo-project', 'Archived Session', undefined, undefined, '/tmp/claude-archived.jsonl');
    sessionsDb.updateSessionIsArchived('claude-archived', true);

    const result = removeSessionForUnlinkedFile('claude', '/tmp/claude-archived.jsonl');

    assert.deepEqual(result, { sessionId: 'claude-archived', provider: 'claude' });
    assert.equal(sessionsDb.getSessionById('claude-archived'), null);
  });
});

test('removeSessionForUnlinkedFile is a no-op for a subagent transcript path', async () => {
  await withIsolatedDatabase(async () => {
    const subagentPath = '/home/user/.claude/projects/demo/claude-parent/subagents/agent-1.jsonl';
    sessionsDb.createSession('claude-parent', 'claude', '/workspace/demo-project', 'Parent', undefined, undefined, '/home/user/.claude/projects/demo/claude-parent.jsonl');

    const result = removeSessionForUnlinkedFile('claude', subagentPath);

    assert.equal(result, null);
    assert.equal(sessionsDb.getSessionById('claude-parent')?.isArchived, 0);
  });
});

test('removeSessionForUnlinkedFile skips the opencode provider entirely', async () => {
  await withIsolatedDatabase(async () => {
    sessionsDb.createSession('opencode-1', 'opencode', '/workspace/demo-project', 'OC Session', undefined, undefined, '/home/user/.local/share/opencode/opencode.db');

    const result = removeSessionForUnlinkedFile('opencode', '/home/user/.local/share/opencode/opencode.db');

    assert.equal(result, null);
    assert.equal(sessionsDb.getSessionById('opencode-1')?.isArchived, 0);
  });
});

test('removeSessionForUnlinkedFile is a no-op when no row matches the path', async () => {
  await withIsolatedDatabase(async () => {
    const result = removeSessionForUnlinkedFile('claude', '/tmp/does-not-exist.jsonl');
    assert.equal(result, null);
  });
});

test('reconcileMissingSessionFiles deletes rows whose transcript no longer exists, including archived ones', async () => {
  await withIsolatedDatabase(async () => {
    await withTempDir('sessions-watcher-fs-', async (dir) => {
      const livePath = path.join(dir, 'live.jsonl');
      const missingPath = path.join(dir, 'missing.jsonl');
      const missingArchivedPath = path.join(dir, 'missing-archived.jsonl');
      await writeFile(livePath, '{}\n', 'utf8');
      // missingPath / missingArchivedPath are intentionally never created.

      sessionsDb.createSession('live-session', 'claude', '/workspace/demo-project', 'Live', undefined, undefined, livePath);
      sessionsDb.createSession('missing-session', 'claude', '/workspace/demo-project', 'Missing', undefined, undefined, missingPath);
      sessionsDb.createSession('opencode-session', 'opencode', '/workspace/demo-project', 'OC', undefined, undefined, '/does/not/exist/opencode.db');
      sessionsDb.createSession('missing-archived-session', 'claude', '/workspace/demo-project', 'Missing archived', undefined, undefined, missingArchivedPath);
      sessionsDb.updateSessionIsArchived('missing-archived-session', true);

      const result = await reconcileMissingSessionFiles();

      // 3 candidates: live-session, missing-session, missing-archived-session.
      // opencode is excluded regardless of archive state.
      assert.equal(result.checkedCount, 3);
      assert.equal(result.removedCount, 2);

      assert.equal(sessionsDb.getSessionById('live-session')?.isArchived, 0);
      assert.equal(sessionsDb.getSessionById('missing-session'), null);
      assert.equal(sessionsDb.getSessionById('opencode-session')?.isArchived, 0);
      assert.equal(sessionsDb.getSessionById('missing-archived-session'), null);
    });
  });
});

test('reconcileMissingSessionFiles continues past a row whose delete throws', async () => {
  await withIsolatedDatabase(async () => {
    await withTempDir('sessions-watcher-fs-', async (dir) => {
      const missingPathA = path.join(dir, 'missing-a.jsonl');
      const missingPathB = path.join(dir, 'missing-b.jsonl');
      // Both paths are intentionally never created.

      sessionsDb.createSession('missing-a', 'claude', '/workspace/demo-project', 'Missing A', undefined, undefined, missingPathA);
      sessionsDb.createSession('missing-b', 'claude', '/workspace/demo-project', 'Missing B', undefined, undefined, missingPathB);

      const originalDeleteSessionById = sessionsDb.deleteSessionById;
      sessionsDb.deleteSessionById = (sessionId: string) => {
        if (sessionId === 'missing-a') {
          throw new Error('simulated delete failure');
        }
        return originalDeleteSessionById(sessionId);
      };

      try {
        const result = await reconcileMissingSessionFiles();

        // The throwing row must not abort the sweep: the remaining candidate
        // is still checked and removed, and the promise resolves rather than
        // rejecting out of reconcileMissingSessionFiles.
        assert.equal(result.checkedCount, 2);
        assert.equal(result.removedCount, 1);
        assert.equal(sessionsDb.getSessionById('missing-a')?.isArchived, 0);
        assert.equal(sessionsDb.getSessionById('missing-b'), null);
      } finally {
        sessionsDb.deleteSessionById = originalDeleteSessionById;
      }
    });
  });
});

test('unarchiveSessionForRealActivity clears isArchived for a session touched by a watcher add/change event', async () => {
  await withIsolatedDatabase(async () => {
    sessionsDb.createSession('claude-1', 'claude', '/workspace/demo-project', 'Session One');
    sessionsDb.updateSessionIsArchived('claude-1', true);

    const unarchived = unarchiveSessionForRealActivity('claude-1');

    assert.equal(unarchived, true);
    assert.equal(sessionsDb.getSessionById('claude-1')?.isArchived, 0);
  });
});

test('unarchiveSessionForRealActivity is a no-op for an already-active session', async () => {
  await withIsolatedDatabase(async () => {
    sessionsDb.createSession('claude-1', 'claude', '/workspace/demo-project', 'Session One');

    const unarchived = unarchiveSessionForRealActivity('claude-1');

    assert.equal(unarchived, false);
    assert.equal(sessionsDb.getSessionById('claude-1')?.isArchived, 0);
  });
});

test('unarchiveSessionForRealActivity is a no-op when no row matches the provider session id', async () => {
  await withIsolatedDatabase(async () => {
    const unarchived = unarchiveSessionForRealActivity('does-not-exist');
    assert.equal(unarchived, false);
  });
});

test('a full synchronizeSessions-style upsert re-creates a row the reconcile sweep removed', async () => {
  // Regression coverage for the delete-not-archive semantics: once the
  // reconcile sweep removes a session row because its transcript is gone,
  // a later createSession call for that same provider-native id (as would
  // run on the next full sync) inserts a fresh, active row rather than
  // resurrecting archive state that no longer exists.
  await withIsolatedDatabase(async () => {
    await withTempDir('sessions-watcher-flap-', async (dir) => {
      const missingPath = path.join(dir, 'missing.jsonl');

      sessionsDb.createSession('claude-1', 'claude', '/workspace/demo-project', 'Session', undefined, undefined, missingPath);

      const reconcileResult = await reconcileMissingSessionFiles();
      assert.equal(reconcileResult.removedCount, 1);
      assert.equal(sessionsDb.getSessionById('claude-1'), null);

      // Simulate the next full sync re-processing the same (still missing,
      // in this scenario) transcript path.
      sessionsDb.createSession('claude-1', 'claude', '/workspace/demo-project', 'Session', undefined, undefined, missingPath);

      assert.equal(sessionsDb.getSessionById('claude-1')?.isArchived, 0);
    });
  });
});
