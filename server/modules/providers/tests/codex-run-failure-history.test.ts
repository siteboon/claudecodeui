import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, getConnection, initializeDatabase, sessionsDb, sessionRuntimeFailuresDb } from '@/modules/database/index.js';
import { sessionsService } from '@/modules/providers/services/sessions.service.js';
import type { SessionRuntimeFailure } from '@/shared/index.js';

test('failure survives database reopen and joins history before pagination without exposing diagnostics', async () => {
  const previous = process.env.DATABASE_PATH;
  const root = await mkdtemp(path.join(os.tmpdir(), 'codex-failure-history-'));
  closeConnection();
  process.env.DATABASE_PATH = path.join(root, 'auth.db');
  try {
    await initializeDatabase();
    const now = Date.now();
    const timestamp = (delta: number) => new Date(now + delta).toISOString();
    const transcript = path.join(root, 'rollout.jsonl');
    await writeFile(transcript, [
      { timestamp: timestamp(-5000), type: 'session_meta', payload: { id: 'native', cwd: root } },
      { timestamp: timestamp(-4000), type: 'event_msg', payload: { type: 'user_message', message: 'Question' } },
      { timestamp: timestamp(0), type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Later reply' }] } },
    ].map((row) => JSON.stringify(row)).join('\n') + '\n');
    sessionsDb.createAppSession('app', 'codex', root);
    sessionsDb.assignProviderSessionId('app', 'native');
    sessionsDb.createSession('native', 'codex', root, undefined, undefined, undefined, transcript);
    const failure: SessionRuntimeFailure = {
      id: 'failure-1', sessionId: 'app', provider: 'codex', startedAt: timestamp(-4500), timestamp: timestamp(-2000),
      code: 'CODEX_STREAM_ERROR', content: 'Codex stopped before completing its reply.',
      diagnostics: { providerSessionId: 'native', model: 'model', effort: 'high', lastEventType: 'turn.started',
        eventCount: 2, sawTurnCompleted: false, sawAssistantMessage: false, exitCode: 1, signal: null,
        errorName: 'AbortError', transportCode: 'ECONNRESET' },
    };
    assert.equal((await sessionsService.fetchHistory('app')).total, 2); // Prime the transcript cache.
    sessionRuntimeFailuresDb.record(failure);
    sessionRuntimeFailuresDb.record(failure);
    closeConnection();
    await initializeDatabase();
    assert.deepEqual(sessionRuntimeFailuresDb.list('app'), [failure]);
    // An edit can move an app session to another native transcript. Failures
    // of an abandoned provider thread must not leak into its current history.
    sessionRuntimeFailuresDb.record({ ...failure, id: 'abandoned-failure',
      diagnostics: { ...failure.diagnostics, providerSessionId: 'old-native-thread' } });
    const provider = sessionsService;
    const full = await provider.fetchHistory('app');
    assert.equal(full.total, 3);
    assert.deepEqual(full.messages.map((message) => message.content), ['Question', failure.content, 'Later reply']);
    const page = await provider.fetchHistory('app', { limit: 1, offset: 1 });
    assert.equal(page.total, 3);
    assert.equal(page.hasMore, true);
    assert.equal(page.messages[0]?.id, failure.id);
    assert.equal(page.messages[0]?.kind, 'error');
    assert.doesNotMatch(JSON.stringify(page), /ECONNRESET|AbortError|diagnostics/);

    // A failed first launch can have no rollout file at all.
    sessionsDb.createAppSession('no-rollout', 'codex', root);
    sessionRuntimeFailuresDb.record({ ...failure, id: 'failure-2', sessionId: 'no-rollout' });
    assert.equal((await provider.fetchHistory('no-rollout')).messages[0]?.id, 'failure-2');

    // Removing the app conversation removes its journal too.
    getConnection().prepare('DELETE FROM sessions WHERE session_id = ?').run('app');
    assert.deepEqual(sessionRuntimeFailuresDb.list('app'), []);
    // No session is created just to save a direct SDK invocation's failure.
    sessionRuntimeFailuresDb.record({ ...failure, sessionId: 'missing' });
    assert.deepEqual(sessionRuntimeFailuresDb.list('missing'), []);

    for (let index = 0; index < 105; index += 1) {
      sessionRuntimeFailuresDb.record({ ...failure, id: `bounded-${String(index).padStart(3, '0')}`, sessionId: 'no-rollout' });
    }
    assert.equal(sessionRuntimeFailuresDb.list('no-rollout').length, 100);
    sessionRuntimeFailuresDb.record({ ...failure, id: 'expired', sessionId: 'no-rollout', timestamp: timestamp(-91 * 86400000) });
    assert.ok(!sessionRuntimeFailuresDb.list('no-rollout').some((row) => row.id === 'expired'));
  } finally {
    closeConnection();
    if (previous === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previous;
    await rm(root, { recursive: true, force: true });
  }
});
