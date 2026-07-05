import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, initializeDatabase, sessionsDb } from '@/modules/database/index.js';
import { sessionsService } from '@/modules/providers/services/sessions.service.js';

async function withIsolatedDatabase(runTest: (tempDirectory: string) => void | Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'sessions-service-'));

  closeConnection();
  process.env.DATABASE_PATH = path.join(tempDirectory, 'auth.db');
  await initializeDatabase();

  try {
    await runTest(tempDirectory);
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

test('archives all active sessions for one project path', async () => {
  await withIsolatedDatabase(async () => {
    sessionsDb.createSession('session-one', 'claude', '/workspace/project-a', 'One');
    sessionsDb.createSession('session-two', 'codex', '/workspace/project-a', 'Two');
    sessionsDb.createSession('session-other', 'claude', '/workspace/project-b', 'Other');

    const result = await sessionsService.deleteOrArchiveSessionsByProjectPath('/workspace/project-a');

    assert.deepEqual(result, {
      projectPath: '/workspace/project-a',
      action: 'archived',
      count: 2,
      deletedFromDisk: 0,
    });
    assert.equal(sessionsDb.getSessionById('session-one')?.isArchived, 1);
    assert.equal(sessionsDb.getSessionById('session-two')?.isArchived, 1);
    assert.equal(sessionsDb.getSessionById('session-other')?.isArchived, 0);
  });
});

test('branches a session into a new app-owned session row', async () => {
  await withIsolatedDatabase(async () => {
    sessionsDb.createSession('source-provider-session', 'claude', '/workspace/project-a', 'Source Session');

    const result = await sessionsService.branchSessionById('source-provider-session');
    const branched = sessionsDb.getSessionById(result.sessionId);

    assert.notEqual(result.sessionId, 'source-provider-session');
    assert.equal(result.sourceSessionId, 'source-provider-session');
    assert.equal(result.provider, 'claude');
    assert.equal(result.projectPath, '/workspace/project-a');
    assert.equal(result.copiedHistory, false);
    assert.equal(branched?.provider, 'claude');
    assert.equal(branched?.provider_session_id, null);
    assert.equal(branched?.project_path, '/workspace/project-a');
    assert.equal(branched?.custom_name, 'Branch of Source Session');
  });
});

test('archives multiple sessions by id in one operation', async () => {
  await withIsolatedDatabase(async () => {
    sessionsDb.createSession('session-one', 'claude', '/workspace/project-a', 'One');
    sessionsDb.createSession('session-two', 'codex', '/workspace/project-a', 'Two');
    sessionsDb.createSession('session-other', 'claude', '/workspace/project-a', 'Other');

    const result = await sessionsService.deleteOrArchiveSessionsByIds(['session-one', 'session-two']);

    assert.deepEqual(result, {
      sessionIds: ['session-one', 'session-two'],
      action: 'archived',
      count: 2,
      deletedFromDisk: 0,
    });
    assert.equal(sessionsDb.getSessionById('session-one')?.isArchived, 1);
    assert.equal(sessionsDb.getSessionById('session-two')?.isArchived, 1);
    assert.equal(sessionsDb.getSessionById('session-other')?.isArchived, 0);
  });
});

test('branches a file-backed session by copying transcript history', async () => {
  await withIsolatedDatabase(async (tempDirectory) => {
    const transcriptPath = path.join(tempDirectory, 'source-provider-session.jsonl');
    await writeFile(transcriptPath, [
      JSON.stringify({
        type: 'summary',
        sessionId: 'source-provider-session',
        session_id: 'source-provider-session',
        cwd: '/workspace/project-a',
      }),
    ].join('\n'));
    sessionsDb.createSession(
      'source-provider-session',
      'claude',
      '/workspace/project-a',
      'Source Session',
      undefined,
      undefined,
      transcriptPath,
    );

    const result = await sessionsService.branchSessionById('source-provider-session');
    const branched = sessionsDb.getSessionById(result.sessionId);
    const copiedTranscript = await readFile(branched?.jsonl_path || '', 'utf8');

    assert.equal(result.copiedHistory, true);
    assert.equal(branched?.provider_session_id, result.sessionId);
    assert.equal(branched?.custom_name, 'Branch of Source Session');
    assert.equal(copiedTranscript.includes('source-provider-session'), false);
    assert.equal(copiedTranscript.includes(result.sessionId), true);
  });
});
