import assert from 'node:assert/strict';
import test from 'node:test';

import { CodexSessionsProvider } from '@/modules/providers/list/codex/codex-sessions.provider.js';
import { transformCodexAppServerItem } from '@/modules/providers/list/codex/codex-app-server.runtime.js';

for (const change of [
  { kind: { type: 'add' }, diff: '+literal\nadded\n', oldText: '', newText: '+literal\nadded\n', toolName: 'Write' },
  { kind: { type: 'delete' }, diff: '-literal\nremoved\n', oldText: '-literal\nremoved\n', newText: '', toolName: 'Edit' },
  { kind: { type: 'update', move_path: null }, diff: '--- a/file.txt\n+++ b/file.txt\n@@ -1,2 +1,2 @@\n context\n-before\n+after\n', oldText: 'context\nbefore', newText: 'context\nafter', toolName: 'Edit' },
]) {
  test(`app-server ${change.kind.type} diffs are preserved in live messages and history`, async () => {
    const item = {
      type: 'fileChange', id: 'file-change', status: 'completed',
      changes: [{ path: '/tmp/file.txt', kind: change.kind, diff: change.diff }],
    };
    const provider = new CodexSessionsProvider({
      appServer: {
        async readThread() {
          return { thread: { turns: [{ id: 'turn-files', itemsView: 'full', items: [item] }] } };
        },
      },
      readRuntimeMode: () => 'app-server',
    });
    const live = provider.normalizeMessage(transformCodexAppServerItem(item), 'file-session');
    const history = await provider.fetchHistory('file-session', { providerSessionId: 'thread-files' });

    for (const messages of [live, history.messages]) {
      assert.equal(messages.length, 1);
      assert.equal(messages[0].toolName, change.toolName);
      assert.deepEqual(messages[0].toolInput, {
        file_path: '/tmp/file.txt', old_string: change.oldText, new_string: change.newText,
        ...(change.kind.type === 'delete' ? { deleted: true } : {}),
      });
    }
  });
}

test('explicit app-server history overrides the SDK environment default', async () => {
  let reads = 0;
  const provider = new CodexSessionsProvider({
    readRuntimeMode: () => 'sdk',
    appServer: {
      async readThread() {
        reads += 1;
        return { thread: { turns: [] } };
      },
    },
  });

  await provider.fetchHistory('app-history', {
    providerSessionId: 'thread-history', codexRuntimeMode: 'app-server',
  });
  assert.equal(reads, 1);
});

test('app-server history uses the shared Codex normalizer', async () => {
  const provider = new CodexSessionsProvider({
    readRuntimeMode: () => 'app-server',
    appServer: {
      async readThread() {
        return {
          thread: {
            id: 'thread-history',
            createdAt: 1_786_100_000,
            turns: [{
              id: 'turn-history',
              itemsView: 'full',
              status: 'completed',
              startedAt: 1_786_100_010,
              items: [
                {
                  type: 'userMessage',
                  id: 'user-1',
                  content: [{ type: 'text', text: 'Review this input' }],
                },
                {
                  type: 'commandExecution',
                  id: 'command-1',
                  command: 'npm test',
                  aggregatedOutput: 'all tests passed',
                  exitCode: 0,
                  status: 'completed',
                },
                { type: 'agentMessage', id: 'agent-1', text: 'Done.' },
              ],
            }],
          },
        };
      },
    },
  });

  const history = await provider.fetchHistory('app-history', {
    providerSessionId: 'thread-history',
  });

  assert.equal(history.messages.some((message) => message.role === 'user' && message.content === 'Review this input'), true);
  assert.equal(history.messages.find((message) => message.role === 'user')?.transcriptAnchorId, 'turn-history');
  assert.equal(history.messages.some((message) => message.role === 'assistant' && message.content === 'Done.'), true);
  assert.deepEqual(
    history.messages.find((message) => message.toolName === 'Bash')?.toolResult,
    { content: 'all tests passed', isError: false },
  );
});

test('app-server history anchors only the first user message in each turn', async () => {
  const provider = new CodexSessionsProvider({
    readRuntimeMode: () => 'app-server',
    appServer: {
      async readThread() {
        return {
          thread: {
            id: 'thread-history',
            turns: ['turn-first', 'turn-second'].map((turnId) => ({
              id: turnId,
              itemsView: 'full',
              status: 'completed',
              startedAt: 1_786_100_010,
              items: [
                { type: 'agentMessage', id: `${turnId}-assistant`, text: 'Context' },
                ...['first', 'second'].map((prompt) => ({
                  type: 'userMessage',
                  id: `${turnId}-${prompt}`,
                  content: [{ type: 'text', text: `${turnId} ${prompt}` }],
                })),
              ],
            })),
          },
        };
      },
    },
  });

  const history = await provider.fetchHistory('app-history', { providerSessionId: 'thread-history' });
  const userMessages = history.messages.filter((message) => message.role === 'user');

  assert.deepEqual(userMessages.map((message) => message.transcriptAnchorId ?? null), [
    'turn-first', null, 'turn-second', null,
  ]);
  assert.equal(userMessages[0]?.timestamp, new Date(1_786_100_010_000).toISOString());
});

test('app-server history stays empty for new or detached sessions without a provider thread', async () => {
  const provider = new CodexSessionsProvider({
    readRuntimeMode: () => 'app-server',
    appServer: {
      async readThread() {
        assert.fail('A session without a provider thread must not call thread/read');
      },
    },
  });

  for (const providerSessionId of [undefined, '']) {
    const history = await provider.fetchHistory('app-without-thread', {
      providerSessionId,
      limit: 5,
      offset: 2,
    });
    assert.deepEqual(history, { messages: [], total: 0, hasMore: false, limit: 5, offset: 2 });
  }
});

test('app-server history rejects incomplete turns without a JSONL fallback', async () => {
  const provider = new CodexSessionsProvider({
    readRuntimeMode: () => 'app-server',
    appServer: {
      async readThread() {
        return {
          thread: {
            id: 'thread-incomplete',
            turns: [{ id: 'turn-1', itemsView: 'summary', items: [] }],
          },
        };
      },
    },
  });

  await assert.rejects(
    provider.fetchHistory('app-history', { providerSessionId: 'thread-incomplete' }),
    /incomplete turn item view/,
  );
});
