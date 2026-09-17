import assert from 'node:assert/strict';

import { test } from 'vitest';

import type { NormalizedMessage } from '@/shared/types';
import { evictRealtimeOverflow } from '@/modules/chat/hooks/useSessionStore';

const LIMIT = 500;
const HARD_LIMIT = 1000;

let seq = 0;
const row = (overrides: Partial<NormalizedMessage> = {}): NormalizedMessage => ({
  id: `m${(seq += 1)}`,
  sessionId: 's1',
  timestamp: '2026-09-17T00:00:00.000Z',
  provider: 'claude',
  kind: 'text',
  role: 'assistant',
  ...overrides,
});

const filler = (count: number) => Array.from({ length: count }, () => row());

test('a buffer under the limit is returned untouched', () => {
  const messages = filler(10);
  assert.strictEqual(evictRealtimeOverflow(messages), messages);
});

test('overflow evicts oldest-first when nothing needs protecting', () => {
  const messages = filler(LIMIT + 10);
  const kept = evictRealtimeOverflow(messages);

  assert.equal(kept.length, LIMIT);
  assert.equal(kept[0]?.id, messages[10]?.id, 'the ten oldest should be the ones dropped');
});

// The defect this function exists for: the container is the oldest row of its
// group while its children are the newest, so a flat FIFO evicts exactly the
// row the children need.
test('a container is kept while its subagent rows are still arriving', () => {
  const container = row({ kind: 'tool_use', toolId: 'agent-1', toolName: 'Agent' });
  const messages = [container, ...filler(LIMIT + 50), row({ parentToolUseId: 'agent-1' })];

  const kept = evictRealtimeOverflow(messages);

  assert.ok(
    kept.some((m) => m.toolId === 'agent-1'),
    'the agent card would otherwise be left empty for the rest of the session',
  );
  assert.equal(kept.length, LIMIT);
});

test('a container whose result has arrived is evictable again', () => {
  const container = row({ kind: 'tool_use', toolId: 'agent-1', toolName: 'Agent' });
  const messages = [
    container,
    row({ kind: 'tool_result', toolId: 'agent-1' }),
    row({ parentToolUseId: 'agent-1' }),
    ...filler(LIMIT + 50),
  ];

  const kept = evictRealtimeOverflow(messages);

  assert.ok(!kept.some((m) => m.kind === 'tool_use' && m.toolId === 'agent-1'));
  assert.equal(kept.length, LIMIT);
});

test('a tool call nobody references is not protected', () => {
  const messages = [
    row({ kind: 'tool_use', toolId: 'plain-1', toolName: 'Read' }),
    ...filler(LIMIT + 50),
  ];

  const kept = evictRealtimeOverflow(messages);

  assert.ok(!kept.some((m) => m.toolId === 'plain-1'));
});

test('several live containers are all kept', () => {
  const containers = ['a', 'b', 'c'].map((id) =>
    row({ kind: 'tool_use', toolId: id, toolName: 'Agent' }));
  const children = ['a', 'b', 'c'].map((id) => row({ parentToolUseId: id }));
  const kept = evictRealtimeOverflow([...containers, ...filler(LIMIT + 20), ...children]);

  for (const id of ['a', 'b', 'c']) {
    assert.ok(kept.some((m) => m.toolId === id), `container ${id} should survive`);
  }
});

// Protection must not become a leak: an agent that never reports would
// otherwise pin its container, and every row after it, forever.
test('the hard ceiling evicts protected containers rather than growing unbounded', () => {
  const containers = Array.from({ length: 900 }, (_, i) =>
    row({ kind: 'tool_use', toolId: `agent-${i}`, toolName: 'Agent' }));
  const children = Array.from({ length: 900 }, (_, i) =>
    row({ parentToolUseId: `agent-${i}` }));

  const kept = evictRealtimeOverflow([...containers, ...filler(200), ...children]);

  assert.ok(kept.length <= HARD_LIMIT, `buffer grew to ${kept.length}`);
});

test('growth stays bounded when the same buffer is trimmed repeatedly', () => {
  let buffer: NormalizedMessage[] = [];
  for (let i = 0; i < 3000; i += 1) {
    buffer = evictRealtimeOverflow([
      ...buffer,
      i % 2 === 0
        ? row({ kind: 'tool_use', toolId: `agent-${i}`, toolName: 'Agent' })
        : row({ parentToolUseId: `agent-${i - 1}` }),
    ]);
    assert.ok(buffer.length <= HARD_LIMIT, `buffer grew to ${buffer.length} at step ${i}`);
  }
});
