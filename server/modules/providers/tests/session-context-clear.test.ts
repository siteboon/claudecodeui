import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, initializeDatabase, sessionsDb } from '@/modules/database/index.js';
import { ClaudeSessionSynchronizer } from '@/modules/providers/list/claude/claude-session-synchronizer.provider.js';
import { providerTokenUsageService } from '@/modules/providers/services/provider-token-usage.service.js';
import { sessionsService } from '@/modules/providers/services/sessions.service.js';
import { chatRunRegistry } from '@/modules/websocket/index.js';

const PROJECT_PATH = '/tmp/context-clear-project';

/** Runs one test against a fresh database and a scratch transcript folder. */
async function withIsolatedSessions(runTest: (transcriptDirectory: string) => Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'context-clear-'));

  closeConnection();
  process.env.DATABASE_PATH = path.join(tempDirectory, 'auth.db');
  await initializeDatabase();

  try {
    await runTest(tempDirectory);
  } finally {
    chatRunRegistry.clearAll();
    closeConnection();
    if (previousDatabasePath === undefined) {
      delete process.env.DATABASE_PATH;
    } else {
      process.env.DATABASE_PATH = previousDatabasePath;
    }
    await rm(tempDirectory, { recursive: true, force: true });
  }
}

/** Writes a Claude transcript of alternating user/assistant text rows and returns its path. */
async function writeClaudeTranscript(
  directory: string,
  providerSessionId: string,
  texts: string[],
): Promise<string> {
  const rows = texts.map((text, ordinal) => {
    const role = ordinal % 2 === 0 ? 'user' : 'assistant';
    return {
      type: role,
      uuid: `${providerSessionId}-row-${ordinal}`,
      parentUuid: ordinal === 0 ? null : `${providerSessionId}-row-${ordinal - 1}`,
      timestamp: new Date(Date.UTC(2026, 0, 1, 0, 0, ordinal)).toISOString(),
      sessionId: providerSessionId,
      cwd: PROJECT_PATH,
      message: { role, content: [{ type: 'text', text }] },
    };
  });
  const transcriptPath = path.join(directory, `${providerSessionId}.jsonl`);
  await writeFile(transcriptPath, `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`, 'utf8');
  return transcriptPath;
}

/** Indexes a transcript the way the Claude synchronizer does for a session found on disk. */
function indexTranscript(providerSessionId: string, transcriptPath: string): void {
  sessionsDb.createSession(
    providerSessionId,
    'claude',
    PROJECT_PATH,
    'Context clear conversation',
    '2026-01-01T00:00:00.000Z',
    '2026-01-01T00:00:10.000Z',
    transcriptPath,
  );
}

const isAppError = (code: string, statusCode: number) => (error: unknown): boolean => {
  const typedError = error as { code?: string; statusCode?: number };
  return typedError.code === code && typedError.statusCode === statusCode;
};

test('clearing context keeps the history and starts the next run on a new provider session', { concurrency: false }, async () => {
  await withIsolatedSessions(async (directory) => {
    const sessionId = 'first-context';
    const firstTranscript = await writeClaudeTranscript(directory, sessionId, ['one', 'reply one']);
    indexTranscript(sessionId, firstTranscript);

    const before = await sessionsService.fetchHistory(sessionId);
    assert.ok(before.messages[0].transcriptAnchorId, 'the live context can be edited and forked from');

    assert.deepEqual(await sessionsService.clearSessionContext(sessionId), { sessionId, cleared: true });

    // The next run resumes nothing, and nothing has been used on the new context.
    assert.equal(sessionsService.resolveProviderSessionId(sessionId), null);
    const usage = await providerTokenUsageService.getSessionTokenUsage(sessionId);
    assert.equal(usage.used, 0);

    const cleared = await sessionsService.fetchHistory(sessionId);
    assert.deepEqual(cleared.messages.map((message) => message.content), ['one', 'reply one', 'Context cleared']);
    assert.equal(cleared.messages[2].contextCleared, true);
    assert.equal(cleared.total, 3);
    assert.equal(cleared.tokenUsage, null);
    assert.ok(
      cleared.messages.every((message) => message.transcriptAnchorId === undefined),
      'rows above the marker cannot be edited or forked from',
    );
    assert.ok(cleared.messages.every((message) => message.sessionId === sessionId));

    // The next run announces its own provider session and the indexer finds its file.
    const secondTranscript = await writeClaudeTranscript(directory, 'second-context', ['two', 'reply two']);
    sessionsDb.assignProviderSessionId(sessionId, 'second-context');
    indexTranscript('second-context', secondTranscript);

    const session = sessionsDb.getSessionById(sessionId);
    assert.equal(session?.provider_session_id, 'second-context');
    assert.equal(session?.jsonl_path, secondTranscript);
    assert.equal(sessionsDb.getAllSessions().length, 1, 'the conversation is still one session');

    const stitched = await sessionsService.fetchHistory(sessionId);
    assert.deepEqual(
      stitched.messages.map((message) => message.content),
      ['one', 'reply one', 'Context cleared', 'two', 'reply two'],
    );
    assert.ok(stitched.messages[3].transcriptAnchorId, 'the new context can be edited and forked from');

    // Pages are cut from the whole conversation, across the marker.
    const page = await sessionsService.fetchHistory(sessionId, { limit: 2, offset: 2 });
    assert.deepEqual(page.messages.map((message) => message.content), ['reply one', 'Context cleared']);
    assert.equal(page.total, 5);
    assert.equal(page.hasMore, true);

    // A second clear adds a second part, in order.
    await sessionsService.clearSessionContext(sessionId);
    const twice = await sessionsService.fetchHistory(sessionId);
    assert.deepEqual(
      twice.messages.map((message) => message.content),
      ['one', 'reply one', 'Context cleared', 'two', 'reply two', 'Context cleared'],
    );
  });
});

test('the indexer leaves a cleared transcript with the session that left it', { concurrency: false }, async () => {
  await withIsolatedSessions(async (directory) => {
    // Discovered from disk: the app id is the transcript's own id.
    const sessionId = 'disk-session';
    const transcriptPath = await writeClaudeTranscript(directory, sessionId, ['one', 'reply one']);
    indexTranscript(sessionId, transcriptPath);
    await sessionsService.clearSessionContext(sessionId);

    assert.equal(await new ClaudeSessionSynchronizer().synchronizeFile(transcriptPath), null);

    const session = sessionsDb.getSessionById(sessionId);
    assert.equal(session?.provider_session_id, null, 'the session was not handed back its cleared context');
    assert.equal(sessionsDb.getAllSessions().length, 1);
  });
});

test('clearing a session that has not run changes nothing', { concurrency: false }, async () => {
  await withIsolatedSessions(async () => {
    sessionsDb.createAppSession('fresh-session', 'claude', PROJECT_PATH);

    assert.deepEqual(
      await sessionsService.clearSessionContext('fresh-session'),
      { sessionId: 'fresh-session', cleared: false },
    );
    assert.deepEqual(sessionsDb.getClearedContextSegments('fresh-session'), []);
  });
});

test('clearing context is refused while the session is working', { concurrency: false }, async () => {
  await withIsolatedSessions(async (directory) => {
    const sessionId = 'busy-session';
    indexTranscript(sessionId, await writeClaudeTranscript(directory, sessionId, ['one', 'reply one']));
    chatRunRegistry.startRun({
      appSessionId: sessionId, provider: 'claude', providerSessionId: sessionId, connection: null, userId: null,
    });

    await assert.rejects(sessionsService.clearSessionContext(sessionId), isAppError('SESSION_BUSY', 409));
    assert.equal(sessionsDb.getSessionById(sessionId)?.provider_session_id, sessionId);
  });
});

test('clearing context is refused for a provider that cannot do it, and for an unknown session', { concurrency: false }, async () => {
  await withIsolatedSessions(async () => {
    sessionsDb.createAppSession('codex-session', 'codex', PROJECT_PATH);
    sessionsDb.assignProviderSessionId('codex-session', 'codex-thread');

    await assert.rejects(
      sessionsService.clearSessionContext('codex-session'),
      isAppError('CONTEXT_CLEAR_NOT_SUPPORTED', 409),
    );
    assert.equal(sessionsDb.getSessionById('codex-session')?.provider_session_id, 'codex-thread');

    await assert.rejects(sessionsService.clearSessionContext('missing'), isAppError('SESSION_NOT_FOUND', 404));
  });
});

test('a session cleared before its transcript was indexed gets its history once the indexer sees the file', { concurrency: false }, async () => {
  await withIsolatedSessions(async (directory) => {
    // Created by the app and run once; the watcher has not reached its file yet.
    const sessionId = 'app-session';
    sessionsDb.createAppSession(sessionId, 'claude', PROJECT_PATH);
    sessionsDb.assignProviderSessionId(sessionId, 'unindexed-context');
    const transcriptPath = await writeClaudeTranscript(directory, 'unindexed-context', ['one', 'reply one']);

    assert.deepEqual(await sessionsService.clearSessionContext(sessionId), { sessionId, cleared: true });

    assert.equal(await new ClaudeSessionSynchronizer().synchronizeFile(transcriptPath), null);
    assert.equal(sessionsDb.getAllSessions().length, 1, 'the cleared transcript is not listed as its own session');

    const history = await sessionsService.fetchHistory(sessionId);
    assert.deepEqual(history.messages.map((message) => message.content), ['one', 'reply one', 'Context cleared']);
  });
});
