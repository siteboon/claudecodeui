import assert from 'node:assert/strict';
import test from 'node:test';

import { collectAgentAssistantMessages } from '@/modules/agent/services/agent-response-collector.service.js';

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

for (const provider of ['cursor', 'opencode', 'codex', 'claude']) {
  test(`non-streaming Agent responses collect normalized ${provider} output`, () => {
    const delta = { kind: 'stream_delta', provider, content: 'partial' };
    const text = { kind: 'text', provider, role: 'assistant', content: 'answer' };
    assert.deepEqual(collectAgentAssistantMessages([
      delta, JSON.stringify(text),
      { kind: 'text', provider, role: 'user', content: 'prompt' },
      { kind: 'tool_result', provider, content: 'tool output' },
      { kind: 'error', provider, content: 'error' },
      { kind: 'complete', provider },
      'invalid json', null,
    ]), [delta, text]);
  });
}
