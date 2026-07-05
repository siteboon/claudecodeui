import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, initializeDatabase, sessionsDb } from '@/modules/database/index.js';
import { handleSessionArtifactDeleted } from '@/modules/providers/index.js';
import { connectedClients, WS_OPEN_STATE } from '@/modules/websocket/index.js';

async function withIsolatedDatabase(runTest: () => void | Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'sessions-watcher-'));
  const databasePath = path.join(tempDirectory, 'auth.db');

  closeConnection();
  process.env.DATABASE_PATH = databasePath;
  await initializeDatabase();

  try {
    await runTest();
  } finally {
    connectedClients.clear();
    closeConnection();
    if (previousDatabasePath === undefined) {
      delete process.env.DATABASE_PATH;
    } else {
      process.env.DATABASE_PATH = previousDatabasePath;
    }
    await rm(tempDirectory, { recursive: true, force: true });
  }
}

test('session watcher unlink deletes matching transcript row and broadcasts deletion', async () => {
  await withIsolatedDatabase(async () => {
    const transcriptPath = path.join(tmpdir(), 'watcher-deleted.jsonl');
    const frames: unknown[] = [];
    connectedClients.add({
      readyState: WS_OPEN_STATE,
      send: (data: string) => {
        frames.push(JSON.parse(data) as unknown);
      },
    });

    sessionsDb.createSession(
      'session-deleted',
      'claude',
      '/workspace/demo-project',
      'Deleted Transcript',
      undefined,
      undefined,
      transcriptPath,
    );

    const deletedSessionId = await handleSessionArtifactDeleted('unlink', transcriptPath, 'claude');

    assert.equal(deletedSessionId, 'session-deleted');
    assert.equal(sessionsDb.getSessionById('session-deleted'), null);
    assert.deepEqual(frames, [
      {
        kind: 'session_deleted',
        sessionId: 'session-deleted',
        provider: 'claude',
      },
    ]);
  });
});
