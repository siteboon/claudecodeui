import assert from 'node:assert/strict';
import test from 'node:test';

import { collectAgentAssistantMessages } from '@/modules/agent/agent.routes.js';

test('non-streaming Agent responses collect normalized AGY output', () => {
  const collected = collectAgentAssistantMessages([
    { kind: 'stream_delta', provider: 'antigravity', content: 'first ' },
    JSON.stringify({ kind: 'stream_delta', provider: 'antigravity', content: 'second' }),
    { kind: 'text', provider: 'antigravity', role: 'user', content: 'ignore me' },
    { kind: 'complete', provider: 'antigravity', content: 'ignore terminal frame' },
  ]) as Array<{ content: string }>;

  assert.deepEqual(collected.map((message) => message.content), ['first ', 'second']);
});

test('non-streaming Agent responses preserve legacy Claude assistant messages', () => {
  const assistant = { type: 'assistant', message: { content: 'legacy' } };
  assert.deepEqual(
    collectAgentAssistantMessages([{ type: 'claude-response', data: assistant }]),
    [assistant],
  );
});
