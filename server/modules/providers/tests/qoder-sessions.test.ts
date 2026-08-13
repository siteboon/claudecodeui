import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, initializeDatabase, sessionsDb } from '@/modules/database/index.js';
import { QoderSessionsProvider } from '@/modules/providers/list/qoder/qoder-sessions.provider.js';

const provider = new QoderSessionsProvider();

async function withIsolatedDatabase(runTest: () => void | Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'qoder-sessions-test-'));
  closeConnection();
  process.env.DATABASE_PATH = path.join(tempDirectory, 'auth.db');
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

// ---------------------------------------------------------------------------
// normalizeMessage
// ---------------------------------------------------------------------------

test('normalizeMessage: system/init event is dropped', () => {
  const messages = provider.normalizeMessage(
    { type: 'system', subtype: 'init', sessionID: 'sess-1' },
    'sess-1',
  );
  assert.deepEqual(messages, []);
});

test('normalizeMessage: content_block_delta produces a stream_delta', () => {
  const messages = provider.normalizeMessage(
    { type: 'content_block_delta', delta: { text: 'hello' } },
    'sess-1',
  );
  assert.equal(messages.length, 1);
  assert.equal(messages[0].kind, 'stream_delta');
  assert.equal(messages[0].content, 'hello');
  assert.equal(messages[0].provider, 'qoder');
});

test('normalizeMessage: content_block_stop produces a stream_end', () => {
  const messages = provider.normalizeMessage(
    { type: 'content_block_stop' },
    'sess-1',
  );
  assert.equal(messages.length, 1);
  assert.equal(messages[0].kind, 'stream_end');
});

test('normalizeMessage: result with string result produces an assistant text message', () => {
  const messages = provider.normalizeMessage(
    { type: 'result', subtype: 'success', result: 'Done' },
    'sess-1',
  );
  assert.equal(messages.length, 1);
  assert.equal(messages[0].kind, 'text');
  assert.equal(messages[0].role, 'assistant');
  assert.equal(messages[0].content, 'Done');
});

test('normalizeMessage: result with content array produces multiple text messages', () => {
  const messages = provider.normalizeMessage(
    {
      type: 'result',
      result: {
        content: [
          { type: 'text', text: 'part 1' },
          { type: 'text', text: 'part 2' },
        ],
      },
    },
    'sess-1',
  );
  assert.equal(messages.length, 2);
  assert.equal(messages[0].content, 'part 1');
  assert.equal(messages[1].content, 'part 2');
});

test('normalizeMessage: user text message with string content', () => {
  const messages = provider.normalizeMessage(
    { type: 'user', message: { role: 'user', content: 'hello world' } },
    'sess-1',
  );
  assert.equal(messages.length, 1);
  assert.equal(messages[0].kind, 'text');
  assert.equal(messages[0].role, 'user');
  assert.equal(messages[0].content, 'hello world');
});

test('normalizeMessage: assistant text/thinking/tool_use parts', () => {
  const messages = provider.normalizeMessage(
    {
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'hmm' },
          { type: 'text', text: 'answer' },
          { type: 'tool_use', id: 'tu-1', name: 'Read', input: { path: '/a' } },
        ],
      },
    },
    'sess-1',
  );
  assert.equal(messages.length, 3);
  assert.equal(messages[0].kind, 'thinking');
  assert.equal(messages[0].content, 'hmm');
  assert.equal(messages[1].kind, 'text');
  assert.equal(messages[1].content, 'answer');
  assert.equal(messages[2].kind, 'tool_use');
  assert.equal(messages[2].toolName, 'Read');
});

test('normalizeMessage: tool_result in user message content array', () => {
  const messages = provider.normalizeMessage(
    {
      type: 'user',
      message: {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'tu-1', content: 'result text', is_error: false },
        ],
      },
    },
    'sess-1',
  );
  assert.equal(messages.length, 1);
  assert.equal(messages[0].kind, 'tool_result');
  assert.equal(messages[0].toolId, 'tu-1');
  assert.equal(messages[0].content, 'result text');
  assert.equal(messages[0].isError, false);
});

test('normalizeMessage: error event produces an error message', () => {
  const messages = provider.normalizeMessage(
    { type: 'error', error: { message: 'something broke' } },
    'sess-1',
  );
  assert.equal(messages.length, 1);
  assert.equal(messages[0].kind, 'error');
  assert.equal(messages[0].content, 'something broke');
});

test('normalizeMessage: internal meta rows are dropped', () => {
  for (const type of ['workspace-directories', 'runtime-config', 'ai-title', 'last-prompt']) {
    const messages = provider.normalizeMessage({ type, data: 'whatever' }, 'sess-1');
    assert.deepEqual(messages, [], `expected no messages for ${type}`);
  }
});

// ---------------------------------------------------------------------------
// fetchHistory
// ---------------------------------------------------------------------------

test('fetchHistory: returns empty result when session file does not exist', async () => {
  await withIsolatedDatabase(async () => {
    const result = await provider.fetchHistory('nonexistent', {});
    assert.deepEqual(result, {
      messages: [],
      total: 0,
      hasMore: false,
      offset: 0,
      limit: null,
    });
  });
});

test('fetchHistory: returns normalized messages from a JSONL transcript', async () => {
  await withIsolatedDatabase(async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), 'qoder-fetch-'));
    const jsonlPath = path.join(tempDir, 'session.jsonl');

    await writeFile(jsonlPath, [
      JSON.stringify({
        type: 'user',
        sessionId: 'sess-fetch',
        timestamp: '2026-01-01T00:00:00.000Z',
        uuid: 'u1',
        message: { role: 'user', content: 'hello' },
      }),
      JSON.stringify({
        type: 'assistant',
        sessionId: 'sess-fetch',
        timestamp: '2026-01-01T00:01:00.000Z',
        uuid: 'a1',
        message: { role: 'assistant', content: [{ type: 'text', text: 'hi there' }] },
      }),
    ].join('\n'));

    sessionsDb.createSession(
      'sess-fetch',
      'qoder',
      '/test',
      'Test Session',
      '2026-01-01T00:00:00.000Z',
      '2026-01-01T00:01:00.000Z',
      jsonlPath,
    );

    try {
      const result = await provider.fetchHistory('sess-fetch', {});
      assert.equal(result.total, 2);
      assert.equal(result.messages.length, 2);
      assert.equal(result.messages[0].kind, 'text');
      assert.equal(result.messages[0].role, 'user');
      assert.equal(result.messages[0].content, 'hello');
      assert.equal(result.messages[1].kind, 'text');
      assert.equal(result.messages[1].role, 'assistant');
      assert.equal(result.messages[1].content, 'hi there');
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});

test('fetchHistory: limit=0 returns empty page with correct total', async () => {
  await withIsolatedDatabase(async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), 'qoder-limit0-'));
    const jsonlPath = path.join(tempDir, 'session.jsonl');

    await writeFile(jsonlPath, [
      JSON.stringify({
        type: 'user',
        sessionId: 'sess-l0',
        timestamp: '2026-01-01T00:00:00.000Z',
        uuid: 'u1',
        message: { role: 'user', content: 'hello' },
      }),
      JSON.stringify({
        type: 'assistant',
        sessionId: 'sess-l0',
        timestamp: '2026-01-01T00:01:00.000Z',
        uuid: 'a1',
        message: { role: 'assistant', content: [{ type: 'text', text: 'hi' }] },
      }),
    ].join('\n'));

    sessionsDb.createSession(
      'sess-l0',
      'qoder',
      '/test',
      'Test',
      '2026-01-01T00:00:00.000Z',
      '2026-01-01T00:01:00.000Z',
      jsonlPath,
    );

    try {
      const result = await provider.fetchHistory('sess-l0', { limit: 0 });
      assert.equal(result.total, 2);
      assert.equal(result.messages.length, 0);
      assert.equal(result.hasMore, true);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});

test('fetchHistory: result string form is normalized as assistant text', async () => {
  await withIsolatedDatabase(async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), 'qoder-result-'));
    const jsonlPath = path.join(tempDir, 'session.jsonl');

    await writeFile(jsonlPath, [
      JSON.stringify({
        type: 'user',
        sessionId: 'sess-r',
        timestamp: '2026-01-01T00:00:00.000Z',
        uuid: 'u1',
        message: { role: 'user', content: 'what is 2+2?' },
      }),
      JSON.stringify({
        type: 'result',
        sessionId: 'sess-r',
        timestamp: '2026-01-01T00:01:00.000Z',
        uuid: 'r1',
        subtype: 'success',
        result: '4',
      }),
    ].join('\n'));

    sessionsDb.createSession(
      'sess-r',
      'qoder',
      '/test',
      'Result Test',
      '2026-01-01T00:00:00.000Z',
      '2026-01-01T00:01:00.000Z',
      jsonlPath,
    );

    try {
      const result = await provider.fetchHistory('sess-r', {});
      assert.equal(result.total, 2);
      assert.equal(result.messages[1].kind, 'text');
      assert.equal(result.messages[1].role, 'assistant');
      assert.equal(result.messages[1].content, '4');
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
