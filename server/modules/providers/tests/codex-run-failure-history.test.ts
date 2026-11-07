import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, getConnection, initializeDatabase, sessionsDb, sessionRuntimeFailuresDb } from '@/modules/database/index.js';
import { sessionsService } from '@/modules/providers/services/sessions.service.js';
import { codexAppServer } from '@/modules/providers/list/codex/codex-app-server.client.js';
import type { SessionRuntimeFailure } from '@/shared/index.js';

async function withHistoryDatabase(run: (root: string) => Promise<void>): Promise<void> {
  const previous = process.env.DATABASE_PATH;
  const root = await mkdtemp(path.join(os.tmpdir(), 'codex-failure-history-'));
  closeConnection();
  process.env.DATABASE_PATH = path.join(root, 'auth.db');
  try {
    await initializeDatabase();
    await run(root);
  } finally {
    closeConnection();
    if (previous === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previous;
    await rm(root, { recursive: true, force: true });
  }
}

function failureFor(sessionId: string, providerSessionId: string | null): SessionRuntimeFailure {
  const timestamp = new Date().toISOString();
  return {
    id: `failure-${sessionId}`, sessionId, provider: 'codex', startedAt: timestamp, timestamp,
    code: 'CODEX_STREAM_ERROR', content: 'Codex stopped before completing its reply.',
    diagnostics: { providerSessionId, model: null, effort: null, lastEventType: null,
      eventCount: 0, sawTurnCompleted: false, sawAssistantMessage: false, exitCode: null, signal: null,
      errorName: 'Error', transportCode: null },
  };
}

test('failure survives database reopen and joins history before pagination without exposing diagnostics', async () => {
  await withHistoryDatabase(async (root) => {
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
    sessionRuntimeFailuresDb.record({ ...failure, id: 'failure-2', sessionId: 'no-rollout',
      diagnostics: { ...failure.diagnostics, providerSessionId: null } });
    assert.equal((await provider.fetchHistory('no-rollout')).messages[0]?.id, 'failure-2');

    // Assigned native ids exercise the provider loader even when the rollout
    // path was never indexed, or the indexed file has since disappeared.
    for (const indexed of [false, true]) {
      const id = `missing-rollout-${indexed}`;
      const nativeId = `native-${id}`;
      sessionsDb.createAppSession(id, 'codex', root);
      sessionsDb.assignProviderSessionId(id, nativeId);
      if (indexed) sessionsDb.createSession(nativeId, 'codex', root, undefined, undefined, undefined, path.join(root, 'absent.jsonl'));
      const saved = failureFor(id, nativeId);
      sessionRuntimeFailuresDb.record(saved);
      assert.equal((await provider.fetchHistory(id)).messages[0]?.id, saved.id);
    }

    // Removing the app conversation removes its journal too.
    getConnection().prepare('DELETE FROM sessions WHERE session_id = ?').run('app');
    assert.deepEqual(sessionRuntimeFailuresDb.list('app'), []);
    // No session is created just to save a direct SDK invocation's failure.
    sessionRuntimeFailuresDb.record({ ...failure, sessionId: 'missing' });
    assert.deepEqual(sessionRuntimeFailuresDb.list('missing'), []);

    sessionRuntimeFailuresDb.record({ ...failure, id: 'expired', sessionId: 'no-rollout', timestamp: timestamp(-91 * 86400000) });
    assert.ok(!sessionRuntimeFailuresDb.list('no-rollout').some((row) => row.id === 'expired'));
    for (let index = 0; index < 105; index += 1) {
      sessionRuntimeFailuresDb.record({ ...failure, id: `bounded-${String(index).padStart(3, '0')}`, sessionId: 'no-rollout' });
    }
    assert.equal(sessionRuntimeFailuresDb.list('no-rollout').length, 100);
  });
});

for (const keepThroughId of [null, 'kept-turn']) {
  test(`rewind clears pre-transcript failures and hides abandoned bound failures (${keepThroughId})`, async (t) => {
    await withHistoryDatabase(async (root) => {
      sessionsDb.createAppSession('edit', 'codex', root);
      const unbound = failureFor('edit', null);
      sessionRuntimeFailuresDb.record(unbound);
      assert.equal((await sessionsService.fetchHistory('edit')).messages[0]?.id, unbound.id);
      sessionsDb.assignProviderSessionId('edit', 'before-edit');
      const bound = { ...failureFor('edit', 'before-edit'), id: 'bound-failure' };
      sessionRuntimeFailuresDb.record(bound);
      assert.equal((await sessionsService.fetchHistory('edit')).total, 2);
      t.mock.method(codexAppServer, 'forkThread', async () => ({ threadId: 'after-edit', path: path.join(root, 'after-edit.jsonl') }));
      await sessionsService.rewindSessionForEdit('edit', keepThroughId);
      assert.deepEqual(sessionRuntimeFailuresDb.list('edit').map((row) => row.id), [bound.id]);
      assert.equal((await sessionsService.fetchHistory('edit')).total, 0);
      // A new launch that fails after the rewind still belongs to this view.
      const current = { ...failureFor('edit', keepThroughId ? 'after-edit' : null), id: 'new-failure' };
      sessionRuntimeFailuresDb.record(current);
      assert.deepEqual((await sessionsService.fetchHistory('edit')).messages.map((row) => row.id), [current.id]);
    });
  });
}

test('a rejected rewind retains the original pre-transcript failure', async (t) => {
  await withHistoryDatabase(async (root) => {
    sessionsDb.createAppSession('failed-edit', 'codex', root);
    sessionsDb.assignProviderSessionId('failed-edit', 'unchanged-native');
    const failure = failureFor('failed-edit', null);
    sessionRuntimeFailuresDb.record(failure);
    t.mock.method(codexAppServer, 'forkThread', async () => { throw new Error('fork unavailable'); });
    await assert.rejects(sessionsService.rewindSessionForEdit('failed-edit', 'kept-turn'), /fork unavailable/);
    assert.deepEqual(sessionRuntimeFailuresDb.list('failed-edit'), [failure]);
    assert.equal((await sessionsService.fetchHistory('failed-edit')).messages[0]?.id, failure.id);
  });
});

for (const keepThroughId of [null, 'kept-turn']) {
  test(`journal cleanup failure does not reject a completed rewind (${keepThroughId})`, async (t) => {
    await withHistoryDatabase(async (root) => {
      const sessionId = 'cleanup-failed-edit';
      sessionsDb.createAppSession(sessionId, 'codex', root);
      sessionsDb.assignProviderSessionId(sessionId, 'before-edit');
      const failure = failureFor(sessionId, null);
      sessionRuntimeFailuresDb.record(failure);
      t.mock.method(codexAppServer, 'forkThread', async () => ({ threadId: 'after-edit', path: path.join(root, 'after-edit.jsonl') }));
      const cleanupError = new Error('journal unavailable');
      const cleanup = t.mock.method(sessionRuntimeFailuresDb, 'clearUnbound', () => { throw cleanupError; });
      const warning = t.mock.method(console, 'warn', () => {});

      await assert.doesNotReject(sessionsService.rewindSessionForEdit(sessionId, keepThroughId));

      assert.equal(sessionsDb.getSessionById(sessionId)?.provider_session_id, keepThroughId ? 'after-edit' : null);
      assert.deepEqual(cleanup.mock.calls.map((call) => call.arguments), [[sessionId]]);
      assert.equal(warning.mock.callCount(), 1);
      assert.deepEqual(warning.mock.calls[0].arguments, [
        '[Sessions] Could not clear pre-transcript Codex failures after rewind', { sessionId }, cleanupError,
      ]);
      // Cleanup is best-effort: the completed rewind remains usable, though
      // the old unbound notice can remain visible when its deletion failed.
      assert.deepEqual(sessionRuntimeFailuresDb.list(sessionId), [failure]);
      assert.deepEqual((await sessionsService.fetchHistory(sessionId)).messages.map((row) => row.id), [failure.id]);
    });
  });
}

for (const sourceState of ['UNAVAILABLE', 'INVALID'] as const) {
  test(`saved failures stay visible beside an explicit inherited history ${sourceState} error`, async () => {
    await withHistoryDatabase(async (root) => {
      const nativeId = `inherited-${sourceState}`;
      const file = path.join(root, 'fork.jsonl');
      const sourceId = 'missing-source';
      const metadata = { timestamp: new Date().toISOString(), type: 'session_meta', payload: { id: nativeId,
        history_base: { thread_id: sourceState === 'INVALID' ? '../invalid-source' : sourceId, end_byte_offset: 0 } } };
      await writeFile(file, JSON.stringify(metadata) + '\n');
      sessionsDb.createAppSession('fork', 'codex', root);
      sessionsDb.assignProviderSessionId('fork', nativeId);
      sessionsDb.createSession(nativeId, 'codex', root, undefined, undefined, undefined, file);
      const code = `CODEX_HISTORY_SOURCE_${sourceState}`;
      // Without a saved failure the existing explicit API error is preserved.
      await assert.rejects(sessionsService.fetchHistory('fork'), { code });
      const failure = failureFor('fork', nativeId);
      sessionRuntimeFailuresDb.record(failure);
      const history = await sessionsService.fetchHistory('fork');
      assert.equal(history.total, 2);
      assert.equal(history.messages[0].id, failure.id);
      assert.equal(history.messages[1].kind, 'error');
      assert.ok(history.messages[1].content?.includes(code));
      assert.ok(history.messages.every((message) => message.sessionId === 'fork'));
      const page = await sessionsService.fetchHistory('fork', { limit: 1, offset: 1 });
      assert.equal(page.messages[0].id, failure.id);
      assert.equal(page.total, 2);
      assert.equal(page.hasMore, false);

      // The failure-only fallback must not be cached as a successful parse.
      if (sourceState === 'UNAVAILABLE') {
        const source = path.join(root, 'source.jsonl');
        await writeFile(source, JSON.stringify({ type: 'session_meta', payload: { id: sourceId } }) + '\n');
        sessionsDb.createSession(sourceId, 'codex', root, undefined, undefined, undefined, source);
      } else {
        await writeFile(file, JSON.stringify({ ...metadata, payload: { id: nativeId } }) + '\n');
      }
      const recovered = await sessionsService.fetchHistory('fork');
      assert.deepEqual(recovered.messages.map((message) => message.id), [failure.id]);
    });
  });
}
