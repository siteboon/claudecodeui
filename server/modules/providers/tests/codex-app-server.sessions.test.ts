import assert from 'node:assert/strict';
import test from 'node:test';

import { CodexSessionsProvider } from '@/modules/providers/list/codex/codex-sessions.provider.js';

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
