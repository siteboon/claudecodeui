import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import type { NormalizedMessage } from '@/shared/types.js';

import { mapPiEventToMessages, PiSessionsProvider } from './pi-sessions.provider.js';

const kinds = (messages: NormalizedMessage[]) => messages.map((message) => message.kind);

test('mapPiEventToMessages maps pi stream events onto normalized messages', () => {
  const delta = mapPiEventToMessages(
    { type: 'message_update', assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: 'Hi' } },
    's1',
  );
  assert.deepEqual(kinds(delta), ['stream_delta']);
  assert.equal(delta[0]?.content, 'Hi');
  assert.equal(delta[0]?.sessionId, 's1');
  assert.equal(delta[0]?.provider, 'pi');

  // `thinking_delta` emits nothing: the frontend appends every non-
  // stream_delta message verbatim, so forwarding per-token deltas would
  // render one thinking fragment per token.
  assert.deepEqual(
    mapPiEventToMessages(
      { type: 'message_update', assistantMessageEvent: { type: 'thinking_delta', contentIndex: 0, delta: 'hmm' } },
      's1',
    ),
    [],
  );

  // `thinking_end` carries the full block content (docs/pi-notes.md) and is
  // the single thinking outlet: one message per reasoning block, verbatim
  // (no trim), so leading/trailing whitespace survives.
  const thinkingEnd = mapPiEventToMessages(
    { type: 'message_update', assistantMessageEvent: { type: 'thinking_end', contentIndex: 0, content: '  full reasoning\n' } },
    's1',
  );
  assert.deepEqual(kinds(thinkingEnd), ['thinking']);
  assert.equal(thinkingEnd[0]?.content, '  full reasoning\n');
  assert.equal(thinkingEnd[0]?.sessionId, 's1');
  assert.equal(thinkingEnd[0]?.provider, 'pi');

  // An empty thinking block emits nothing.
  assert.deepEqual(
    mapPiEventToMessages(
      { type: 'message_update', assistantMessageEvent: { type: 'thinking_end', contentIndex: 0, content: '' } },
      's1',
    ),
    [],
  );

  // Remaining marker events stay silent: `text_end` would duplicate what the
  // stream_delta channel already drew, `thinking_start` starts nothing that
  // `thinking_end` does not carry itself.
  for (const eventType of [
    'text_start',
    'text_end',
    'thinking_start',
    'toolcall_start',
    'toolcall_delta',
    'toolcall_end',
  ]) {
    assert.deepEqual(
      mapPiEventToMessages(
        { type: 'message_update', assistantMessageEvent: { type: eventType, contentIndex: 0, delta: 'x', content: 'x' } },
        's1',
      ),
      [],
      eventType,
    );
  }

  const toolUse = mapPiEventToMessages(
    { type: 'tool_execution_start', toolCallId: 'c1', toolName: 'bash', args: { command: 'ls' } },
    's1',
  );
  assert.deepEqual(kinds(toolUse), ['tool_use']);
  assert.equal(toolUse[0]?.toolName, 'bash');
  assert.equal(toolUse[0]?.toolId, 'c1');
  assert.deepEqual(toolUse[0]?.toolInput, { command: 'ls' });

  const toolResult = mapPiEventToMessages(
    {
      type: 'tool_execution_end',
      toolCallId: 'c1',
      toolName: 'bash',
      result: { content: [{ type: 'text', text: 'a\nb' }] },
      isError: false,
    },
    's1',
  );
  assert.deepEqual(kinds(toolResult), ['tool_result']);
  assert.equal(toolResult[0]?.toolId, 'c1');
  // The transcript renderer reads the top-level `content` string; without it
  // the client's formatToolResultContent crashes on `.trim()`.
  assert.equal(toolResult[0]?.content, 'a\nb');
  assert.deepEqual(toolResult[0]?.toolResult, { content: 'a\nb', isError: false });

  // Streaming partial results only exist for live progress; the transcript
  // draws the tool card from start/end alone.
  assert.deepEqual(
    mapPiEventToMessages({ type: 'tool_execution_update', toolCallId: 'c1', partialResult: { content: [] } }, 's1'),
    [],
  );

  assert.deepEqual(
    kinds(mapPiEventToMessages({ type: 'message_end', message: { role: 'assistant', content: [] } }, 's1')),
    ['stream_end'],
  );
  // User turns were already drawn client-side as the optimistic prompt.
  assert.deepEqual(
    mapPiEventToMessages({ type: 'message_end', message: { role: 'user', content: [{ type: 'text', text: 'q' }] } }, 's1'),
    [],
  );
  assert.deepEqual(
    mapPiEventToMessages({ type: 'message_start', message: { role: 'assistant', content: [] } }, 's1'),
    [],
  );
});

test('mapPiEventToMessages maps model errors to error rows and ignores lifecycle events', () => {
  // pi exits 0 even when the model call failed (docs/pi-notes.md), so this
  // mapping is the only channel a 403/500 has to the UI.
  const modelError = mapPiEventToMessages(
    {
      type: 'message_end',
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: '' }],
        stopReason: 'error',
        errorMessage: '403 {"error":"forbidden"}',
      },
    },
    's1',
  );
  assert.deepEqual(kinds(modelError), ['error']);
  assert.equal(modelError[0]?.content, '403 {"error":"forbidden"}');
  assert.equal(modelError[0]?.isError, true);

  // turn_end repeats the same failure; message_end stays the single outlet so
  // the error is not emitted twice per run.
  assert.deepEqual(
    mapPiEventToMessages(
      { type: 'turn_end', message: { role: 'assistant', content: [], stopReason: 'error', errorMessage: '403' } },
      's1',
    ),
    [],
  );

  assert.deepEqual(kinds(mapPiEventToMessages({ type: 'extension_error', error: 'boom' }, 's1')), ['error']);

  for (const eventType of [
    'session',
    'agent_start',
    'agent_end',
    'agent_settled',
    'turn_start',
    'compaction_start',
    'compaction_end',
    'auto_retry_start',
    'queue_update',
  ]) {
    assert.deepEqual(mapPiEventToMessages({ type: eventType }, 's1'), [], eventType);
  }

  assert.deepEqual(mapPiEventToMessages('not-an-object', 's1'), []);
  assert.deepEqual(mapPiEventToMessages(null, 's1'), []);
});

const PI_SESSION_ID = 'f47ac10b-9d3e-4c7a-8b21-5e6f7a8b9c0d';
// pi encodes the cwd into the folder name; the reader must not depend on that
// scheme, so the fixture uses an opaque directory name.
const PI_SESSION_FILE = `2026-09-12T13-52-05-003Z_${PI_SESSION_ID}.jsonl`;

const historyLine = (entry: Record<string, unknown>) => JSON.stringify(entry);

const HISTORY_LINES = [
  historyLine({
    type: 'session',
    version: 3,
    id: PI_SESSION_ID,
    timestamp: '2026-09-12T13:52:05.003Z',
    cwd: '/tmp/fake-project',
  }),
  // pi also records model/thinking-level switches in the same file.
  historyLine({ type: 'model_change', model: 'glm-5.3' }),
  historyLine({ type: 'thinking_level_change', level: 'high' }),
  historyLine({
    type: 'message',
    id: 'm-user',
    parentId: null,
    timestamp: '2026-09-12T13:52:06.000Z',
    message: {
      role: 'user',
      content: [
        {
          type: 'text',
          text: 'List the files\n\n<images_input>\n1. /tmp/shot.png\n</images_input>\n\n<files_input>\n1. /tmp/notes.md\n</files_input>',
        },
      ],
      api: 'anthropic-messages',
      provider: 'anthropic',
      model: 'glm-5.3',
      stopReason: 'stop',
      usage: { input: 10, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 10 },
    },
  }),
  historyLine({
    type: 'message',
    id: 'm-asst-1',
    parentId: 'm-user',
    timestamp: '2026-09-12T13:52:07.000Z',
    message: {
      role: 'assistant',
      content: [
        { type: 'thinking', thinking: 'Peek at the directory first.', thinkingSignature: 'sig' },
        { type: 'text', text: 'Running ls.' },
        { type: 'toolCall', id: 'call_1', name: 'bash', arguments: { command: 'ls' } },
      ],
      api: 'anthropic-messages',
      provider: 'anthropic',
      model: 'glm-5.3',
      stopReason: 'toolUse',
      usage: { input: 100, output: 20, cacheRead: 10, cacheWrite: 5, totalTokens: 135 },
    },
  }),
  historyLine({
    type: 'message',
    id: 'm-tool-1',
    parentId: 'm-asst-1',
    timestamp: '2026-09-12T13:52:08.000Z',
    message: {
      role: 'toolResult',
      toolCallId: 'call_1',
      toolName: 'bash',
      content: [{ type: 'text', text: 'a.txt\nb.txt' }],
      isError: false,
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 },
    },
  }),
  historyLine({
    type: 'message',
    id: 'm-asst-2',
    parentId: 'm-tool-1',
    timestamp: '2026-09-12T13:52:09.000Z',
    message: {
      role: 'assistant',
      content: [{ type: 'text', text: 'Two files found.' }],
      api: 'anthropic-messages',
      provider: 'anthropic',
      model: 'glm-5.3',
      stopReason: 'stop',
      usage: { input: 150, output: 30, cacheRead: 20, cacheWrite: 0, totalTokens: 200 },
    },
  }),
];

const patchHomeDir = (nextHomeDir: string) => {
  const original = os.homedir;
  (os as any).homedir = () => nextHomeDir;
  return () => {
    (os as any).homedir = original;
  };
};

async function writePiSessionFixture(homeDir: string, lines: string[]): Promise<void> {
  const sessionDir = path.join(homeDir, '.pi', 'agent', 'sessions', '--tmp-fake-project');
  await mkdir(sessionDir, { recursive: true });
  await writeFile(path.join(sessionDir, PI_SESSION_FILE), `${lines.join('\n')}\n`, 'utf8');
}

async function withIsolatedPiHome(run: (homeDir: string) => Promise<void>): Promise<void> {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'pi-sessions-'));
  const restoreHomeDir = patchHomeDir(tempRoot);
  try {
    await run(tempRoot);
  } finally {
    restoreHomeDir();
    await rm(tempRoot, { recursive: true, force: true });
  }
}

test('fetchHistory reads a pi session jsonl with attachments, tool calls and token usage', async () => {
  await withIsolatedPiHome(async (homeDir) => {
    await writePiSessionFixture(homeDir, HISTORY_LINES);
    const provider = new PiSessionsProvider();
    // The reader addresses the transcript by the provider-native id recorded on
    // the session row, never by the app-facing id it was called with.
    const history = await provider.fetchHistory('app-row', { providerSessionId: PI_SESSION_ID });

    assert.equal(history.total, 6);
    const [user, thinking, assistantText, toolUse, toolResult, finalText] = history.messages;

    assert.equal(user?.kind, 'text');
    assert.equal(user?.role, 'user');
    assert.equal(user?.content, 'List the files');
    assert.deepEqual(user?.images, [{ path: '/tmp/shot.png' }]);
    assert.deepEqual(user?.files, [{ path: '/tmp/notes.md' }]);

    assert.equal(thinking?.kind, 'thinking');
    assert.equal(thinking?.content, 'Peek at the directory first.');

    assert.equal(assistantText?.kind, 'text');
    assert.equal(assistantText?.role, 'assistant');
    assert.equal(assistantText?.content, 'Running ls.');

    assert.equal(toolUse?.kind, 'tool_use');
    assert.equal(toolUse?.toolName, 'bash');
    assert.equal(toolUse?.toolId, 'call_1');
    assert.deepEqual(toolUse?.toolInput, { command: 'ls' });

    assert.equal(toolResult?.kind, 'tool_result');
    assert.equal(toolResult?.toolId, 'call_1');
    // Top-level `content` mirrors claude's tool_result shape; the client
    // transcript reads it directly and crashes on undefined without it.
    assert.equal(toolResult?.content, 'a.txt\nb.txt');
    assert.deepEqual(toolResult?.toolResult, { content: 'a.txt\nb.txt', isError: false });

    assert.equal(finalText?.content, 'Two files found.');

    // The last assistant usage is the run's final accounting.
    assert.deepEqual(history.tokenUsage, {
      used: 200,
      inputTokens: 170,
      outputTokens: 30,
      breakdown: { input: 170, output: 30 },
      totalTokens: 200,
    });
  });
});

test('fetchHistory pages from the tail like every other provider', async () => {
  await withIsolatedPiHome(async (homeDir) => {
    await writePiSessionFixture(homeDir, HISTORY_LINES);
    const provider = new PiSessionsProvider();

    const page = await provider.fetchHistory('app-row', { providerSessionId: PI_SESSION_ID, limit: 2 });
    assert.equal(page.total, 6);
    assert.equal(page.messages.length, 2);
    assert.deepEqual(kinds(page.messages), ['tool_result', 'text']);
    assert.equal(page.hasMore, true);

    const older = await provider.fetchHistory('app-row', { providerSessionId: PI_SESSION_ID, limit: 2, offset: 4 });
    assert.deepEqual(older.messages.map((message) => message.content), ['List the files', 'Peek at the directory first.']);
    assert.equal(older.hasMore, false);

    // Partial ids match the transcript file name, so callers may pass the
    // short form a user copied out of a title.
    const byFragment = await provider.fetchHistory('f47ac10b');
    assert.equal(byFragment.total, 6);
  });
});

test('fetchHistory surfaces pi model errors recorded in the transcript', async () => {
  await withIsolatedPiHome(async (homeDir) => {
    await writePiSessionFixture(homeDir, [
      historyLine({ type: 'session', version: 3, id: PI_SESSION_ID, timestamp: '2026-09-12T13:52:05.003Z' }),
      historyLine({
        type: 'message',
        id: 'm-err',
        parentId: null,
        timestamp: '2026-09-12T13:52:06.000Z',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: '' }],
          stopReason: 'error',
          errorMessage: '403 {"error":"forbidden"}',
          usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 },
        },
      }),
    ]);
    const provider = new PiSessionsProvider();
    const history = await provider.fetchHistory(PI_SESSION_ID);

    const errorRow = history.messages.find((message) => message.kind === 'error');
    assert.equal(errorRow?.content, '403 {"error":"forbidden"}');
  });
});

test('fetchHistory returns an empty page when no transcript matches', async () => {
  await withIsolatedPiHome(async (homeDir) => {
    await writePiSessionFixture(homeDir, HISTORY_LINES);
    const provider = new PiSessionsProvider();
    const history = await provider.fetchHistory('missing-session');

    assert.deepEqual(history, { messages: [], total: 0, hasMore: false, offset: 0, limit: null });
  });
});
