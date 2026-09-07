import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, getConnection, initializeDatabase, sessionDraftsDb, sessionsDb, userDb } from '@/modules/database/index.js';
import { sessionHandoffService } from '@/modules/providers/services/session-handoff.service.js';
import { sessionsService } from '@/modules/providers/services/sessions.service.js';
import { chatRunRegistry } from '@/modules/websocket/index.js';
import type { NormalizedMessage } from '@/shared/types.js';

function message(content: string, role: 'user' | 'assistant' = 'user'): NormalizedMessage {
  return { id: content, sessionId: 'source', timestamp: '2026-01-01T00:00:00Z', provider: 'claude', kind: 'text', role, content };
}

async function withDatabase(run: (userId: number) => Promise<void>) {
  const previousPath = process.env.DATABASE_PATH;
  const directory = await mkdtemp(path.join(os.tmpdir(), 'session-handoff-'));
  closeConnection();
  process.env.DATABASE_PATH = path.join(directory, 'auth.db');
  try {
    await initializeDatabase();
    const userId = Number(userDb.createUser('handoff-user', 'unused').id);
    sessionsDb.createAppSession('source', 'claude', directory, 'Fix the build');
    sessionsDb.assignProviderSessionId('source', 'native-source');
    sessionsDb.setSessionModel('source', 'source-model');
    await run(userId);
  } finally {
    closeConnection();
    if (previousPath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previousPath;
    await rm(directory, { recursive: true, force: true });
  }
}

test('handoff creates a durable unsent draft without changing the source or reusing its native ID', async (context) => {
  await withDatabase(async (userId) => {
    const messages = [message('Fix the build'), message('The linker flag is wrong.', 'assistant'),
      { ...message('secret reasoning'), kind: 'thinking' as const },
      { ...message(''), kind: 'tool_use' as const, toolName: 'Bash', toolInput: { command: 'make test' }, toolResult: { content: 'All tests pass' } },
      { ...message(''), kind: 'tool_result' as const, toolResult: { content: 'Standalone tool result' } },
      { ...message('local output'), isLocalCommandStdout: true },
      { ...message('See this diagram'), images: [{ data: 'private-image-bytes' }] },
    ];
    const history = context.mock.method(sessionsService, 'fetchHistory', async () => ({ messages, total: messages.length, hasMore: false, offset: 0, limit: null }));
    const source = sessionsDb.getSessionById('source');
    const result = await sessionHandoffService.createHandoff('native-source', { provider: 'codex', model: 'target-model', userId });
    const target = sessionsDb.getSessionById(result.sessionId);
    assert.ok(target);
    assert.equal(target.provider, 'codex');
    assert.equal(target.provider_session_id, null);
    assert.equal(target.jsonl_path, null);
    assert.equal(target.project_path, source?.project_path);
    assert.equal(target.forked_from_session_id, 'source');
    assert.equal(target.model, 'target-model');
    assert.equal(target.effort, null);
    assert.deepEqual(sessionsDb.getSessionById('source'), source);
    assert.deepEqual(history.mock.calls[0].arguments, ['source']);
    const [draft] = sessionDraftsDb.getDrafts(userId);
    assert.equal(draft.scope, result.sessionId);
    assert.equal(draft.text, result.draft);
    assert.equal(draft.queuedMessage, null);
    assert.match(draft.text, /\/session\/source/);
    assert.match(draft.text, /The linker flag is wrong/);
    assert.match(draft.text, /make test/);
    assert.match(draft.text, /All tests pass/);
    assert.match(draft.text, /Standalone tool result/);
    assert.match(draft.text, /Attachments not copied/);
    assert.doesNotMatch(draft.text, /secret reasoning/);
    assert.doesNotMatch(draft.text, /local output|private-image-bytes/);
    assert.equal(chatRunRegistry.getRun(result.sessionId), undefined);
  });
});

test('handoff bounds long transcripts while retaining the original request and newest context', async (context) => {
  await withDatabase(async (userId) => {
    const messages = [message('Original task'), ...Array.from({ length: 40 }, () => message('history '.repeat(2_000), 'assistant')), message('Latest decision', 'assistant')];
    context.mock.method(sessionsService, 'fetchHistory', async () => ({ messages, total: messages.length, hasMore: false, offset: 0, limit: null }));
    const result = await sessionHandoffService.createHandoff('source', { provider: 'codex', model: 'target', userId });
    assert.ok(result.draft.length < 55_000);
    assert.match(result.draft, /Earlier conversation omitted/);
    assert.match(result.draft, /Original request:\nOriginal task/);
    assert.match(result.draft, /Latest decision/);
    assert.match(result.draft, /\[truncated\]/);
  });
});

test('handoff rejects missing, same-provider, empty, and running sources without creating a session', async (context) => {
  await withDatabase(async (userId) => {
    const target = { provider: 'codex' as const, model: 'target', userId };
    await assert.rejects(sessionHandoffService.createHandoff('missing', target), { code: 'SESSION_NOT_FOUND' });
    await assert.rejects(sessionHandoffService.createHandoff('source', { ...target, provider: 'claude' }), { code: 'HANDOFF_SAME_PROVIDER' });
    context.mock.method(sessionsService, 'fetchHistory', async () => ({ messages: [], total: 0, hasMore: false, offset: 0, limit: null }));
    await assert.rejects(sessionHandoffService.createHandoff('source', target), { code: 'HANDOFF_SOURCE_NOT_READY' });
    context.mock.method(chatRunRegistry, 'isProcessing', () => true);
    await assert.rejects(sessionHandoffService.createHandoff('source', target), { code: 'HANDOFF_SOURCE_BUSY' });
    assert.deepEqual(getConnection().prepare('SELECT COUNT(*) AS count FROM sessions').get(), { count: 1 });
  });
});

test('handoff refuses a source that starts running while history is loading', async (context) => {
  await withDatabase(async (userId) => {
    context.mock.method(sessionsService, 'fetchHistory', async () => {
      context.mock.method(chatRunRegistry, 'isProcessing', () => true);
      return { messages: [message('Task')], total: 1, hasMore: false, offset: 0, limit: null };
    });
    await assert.rejects(sessionHandoffService.createHandoff('source', { provider: 'codex', model: 'target', userId }), { code: 'HANDOFF_SOURCE_BUSY' });
    assert.deepEqual(sessionDraftsDb.getDrafts(userId), []);
  });
});

test('a draft write failure rolls back the new session', async (context) => {
  await withDatabase(async (userId) => {
    context.mock.method(sessionsService, 'fetchHistory', async () => ({ messages: [message('Task')], total: 1, hasMore: false, offset: 0, limit: null }));
    context.mock.method(sessionDraftsDb, 'saveDraft', () => { throw new Error('Disk full'); });
    await assert.rejects(sessionHandoffService.createHandoff('source', { provider: 'codex', model: 'target', userId }), /Disk full/);
    assert.deepEqual(getConnection().prepare('SELECT COUNT(*) AS count FROM sessions').get(), { count: 1 });
  });
});
