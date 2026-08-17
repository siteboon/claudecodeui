import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import Database from 'better-sqlite3';

import { ZCodeSessionsProvider } from '@/modules/providers/list/zcode/zcode-sessions.provider.js';

/** Redirects ZCODE_STORAGE_DIR to a temp dir for fixture isolation. */
const withZCodeStorage = async (runTest: (storageDir: string) => Promise<void>): Promise<void> => {
  const previous = process.env.ZCODE_STORAGE_DIR;
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'zcode-sessions-'));
  process.env.ZCODE_STORAGE_DIR = tempDir;

  try {
    await runTest(tempDir);
  } finally {
    if (previous === undefined) {
      delete process.env.ZCODE_STORAGE_DIR;
    } else {
      process.env.ZCODE_STORAGE_DIR = previous;
    }
    await rm(tempDir, { recursive: true, force: true });
  }
};

/**
 * Creates a fixture ZCode database with one user prompt and one assistant
 * message carrying reasoning/text/tool/step-finish parts (Phase 0.3 schema).
 */
const createFixtureDatabase = async (storageDir: string, sessionId: string): Promise<void> => {
  const dbDir = path.join(storageDir, 'cli', 'db');
  await mkdir(dbDir, { recursive: true });

  const db = new Database(path.join(dbDir, 'db.sqlite'));
  try {
    db.exec(`
      CREATE TABLE message (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        time_created INTEGER NOT NULL,
        time_updated INTEGER NOT NULL,
        data TEXT NOT NULL,
        sequence INTEGER
      );
      CREATE TABLE part (
        id TEXT PRIMARY KEY,
        message_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        time_created INTEGER NOT NULL,
        time_updated INTEGER NOT NULL,
        data TEXT NOT NULL,
        sequence INTEGER
      );
    `);

    const insertMessage = db.prepare(
      'INSERT INTO message (id, session_id, time_created, time_updated, data, sequence) VALUES (?, ?, ?, ?, ?, ?)'
    );
    const insertPart = db.prepare(
      'INSERT INTO part (id, message_id, session_id, time_created, time_updated, data, sequence) VALUES (?, ?, ?, ?, ?, ?, ?)'
    );

    insertMessage.run('msg_user', sessionId, 1000, 1000, JSON.stringify({ role: 'user' }), 0);
    insertPart.run('part_user_text', 'msg_user', sessionId, 1000, 1000, JSON.stringify({ type: 'text', text: 'List the files' }), 0);

    // User prompt whose text lives on the message row, without a part.
    insertMessage.run('msg_user2', sessionId, 1500, 1500, JSON.stringify({ role: 'user', text: 'Second question' }), 1);

    insertMessage.run(
      'msg_asst',
      sessionId,
      2000,
      2000,
      JSON.stringify({
        role: 'assistant',
        modelID: 'GLM-5.3',
        tokens: { input: 100, output: 20, reasoning: 5, cache: { read: 10, write: 0 } },
      }),
      1
    );
    insertPart.run('part_reasoning', 'msg_asst', sessionId, 2000, 2000, JSON.stringify({ type: 'reasoning', text: 'Let me check the directory' }), 0);
    insertPart.run('part_text', 'msg_asst', sessionId, 2100, 2100, JSON.stringify({ type: 'text', text: 'Here are the files' }), 1);
    insertPart.run(
      'part_tool',
      'msg_asst',
      sessionId,
      2200,
      2200,
      JSON.stringify({
        type: 'tool',
        callID: 'call_1',
        tool: 'Bash',
        state: { status: 'completed', input: { command: 'ls' }, output: 'a.txt\nb.txt' },
      }),
      2
    );
    insertPart.run('part_finish', 'msg_asst', sessionId, 2300, 2300, JSON.stringify({ type: 'step-finish' }), 3);
  } finally {
    db.close();
  }
};

test('normalizeMessage maps model_streaming text deltas to stream_delta', () => {
  const provider = new ZCodeSessionsProvider();
  const messages = provider.normalizeMessage(
    { type: 'model_streaming', sessionId: 'sess_1', payload: { kind: 'text_delta', delta: '现在我来' } },
    'sess_1'
  );

  assert.equal(messages.length, 1);
  assert.equal(messages[0].kind, 'stream_delta');
  assert.equal(messages[0].role, 'assistant');
  assert.equal(messages[0].content, '现在我来');
});

test('normalizeMessage maps reasoning deltas to thinking', () => {
  const provider = new ZCodeSessionsProvider();
  const messages = provider.normalizeMessage(
    { type: 'model_streaming', payload: { kind: 'reasoning_delta', delta: 'Let me start' } },
    'sess_1'
  );

  assert.equal(messages.length, 1);
  assert.equal(messages[0].kind, 'thinking');
  assert.equal(messages[0].content, 'Let me start');
});

test('normalizeMessage skips streaming boundary markers with empty deltas', () => {
  const provider = new ZCodeSessionsProvider();
  assert.deepEqual(
    provider.normalizeMessage({ type: 'model_streaming', payload: { kind: 'text_start', delta: '' } }, 'sess_1'),
    []
  );
});

test('normalizeMessage maps tool_call_scheduled to tool_use', () => {
  const provider = new ZCodeSessionsProvider();
  const messages = provider.normalizeMessage(
    {
      type: 'tool_call_scheduled',
      payload: { toolCallId: 'call_9', toolName: 'Read', input: { path: 'a.txt' } },
    },
    'sess_1'
  );

  assert.equal(messages.length, 1);
  assert.equal(messages[0].kind, 'tool_use');
  assert.equal(messages[0].toolName, 'Read');
  assert.equal(messages[0].toolId, 'call_9');
  assert.deepEqual(messages[0].toolInput, { path: 'a.txt' });
});

test('normalizeMessage maps turn_complete usage onto a numeric token count', () => {
  const provider = new ZCodeSessionsProvider();
  const messages = provider.normalizeMessage(
    {
      type: 'turn_complete',
      payload: {
        usage: { inputTokens: 565902, outputTokens: 9160, totalTokens: 575062, reasoningTokens: 0 },
        resultType: 'success',
      },
    },
    'sess_1'
  );

  assert.equal(messages.length, 1);
  assert.equal(messages[0].kind, 'complete');
  assert.equal(messages[0].tokens, 565902 + 9160);
});

test('normalizeMessage unwraps session/event notification payloads', () => {
  const provider = new ZCodeSessionsProvider();
  const messages = provider.normalizeMessage(
    {
      method: 'session/event',
      params: {
        sessionId: 'sess_wrap',
        event: { type: 'model_streaming', payload: { kind: 'text_delta', delta: 'hi' } },
      },
    },
    'sess_wrap'
  );

  assert.equal(messages.length, 1);
  assert.equal(messages[0].kind, 'stream_delta');
  assert.equal(messages[0].sessionId, 'sess_wrap');
});

test('normalizeMessage maps error events', () => {
  const provider = new ZCodeSessionsProvider();
  const messages = provider.normalizeMessage(
    { type: 'error', payload: { message: 'boom' } },
    'sess_1'
  );

  assert.equal(messages.length, 1);
  assert.equal(messages[0].kind, 'error');
  assert.equal(messages[0].isError, true);
  assert.equal(messages[0].text, 'boom');
});

test('normalizeMessage ignores unknown event types', () => {
  const provider = new ZCodeSessionsProvider();
  assert.deepEqual(provider.normalizeMessage({ type: 'model_network_status' }, 'sess_1'), []);
  assert.deepEqual(provider.normalizeMessage({ noType: true }, 'sess_1'), []);
  assert.deepEqual(provider.normalizeMessage('not-an-object', 'sess_1'), []);
});

test('fetchHistory loads and paginates the fixture database', async () => {
  await withZCodeStorage(async (storageDir) => {
    await createFixtureDatabase(storageDir, 'sess_hist');

    const provider = new ZCodeSessionsProvider();
    const result = await provider.fetchHistory('sess_hist');

    const kinds = result.messages.map((message) => message.kind);
    assert.deepEqual(kinds, ['text', 'text', 'thinking', 'text', 'tool_use', 'complete']);
    assert.equal(result.messages[0].role, 'user');
    assert.equal(result.messages[0].content, 'List the files');
    assert.equal(result.messages[1].role, 'user');
    assert.equal(result.messages[1].content, 'Second question');
    assert.equal(result.messages[2].kind, 'thinking');
    assert.equal(result.messages[3].content, 'Here are the files');
    assert.equal(result.messages[4].toolId, 'call_1');
    assert.equal(result.messages[4].toolResult?.isError, false);

    // Token usage aggregates the SQLite tokens shape (cache as read/write).
    const tokenUsage = result.tokenUsage as { inputTokens: number; outputTokens: number };
    assert.equal(tokenUsage.inputTokens, 100);
    assert.equal(tokenUsage.outputTokens, 20);

    // Tail-page pagination: offset 0 + limit keeps the newest messages.
    const page = await provider.fetchHistory('sess_hist', { limit: 2, offset: 0 });
    assert.equal(page.messages.length, 2);
    assert.equal(page.hasMore, true);
  });
});

test('fetchHistory returns empty for sub-agent sessions and missing databases', async () => {
  await withZCodeStorage(async () => {
    const provider = new ZCodeSessionsProvider();

    const subagent = await provider.fetchHistory('sess_subagent_agent_1');
    assert.equal(subagent.total, 0);

    const missing = await provider.fetchHistory('sess_missing');
    assert.equal(missing.total, 0);
    assert.deepEqual(missing.messages, []);
  });
});
