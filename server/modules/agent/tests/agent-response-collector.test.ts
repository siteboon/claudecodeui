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
    ]), [text]);
  });
}

test('final replies replace only their own deltas and retain earlier delta-only replies', () => {
  const first = { kind: 'stream_delta', provider: 'antigravity', sessionId: 'a', content: 'first' };
  const other = { kind: 'stream_delta', provider: 'antigravity', sessionId: 'b', content: 'other' };
  const final = { kind: 'text', provider: 'antigravity', sessionId: 'a', content: 'second' };
  assert.deepEqual(collectAgentAssistantMessages([
    first, { kind: 'stream_end', provider: 'antigravity', sessionId: 'a' },
    { ...first, content: 'sec' }, other, final,
  ]), [first, other, final]);
});

test('a block stop retains deltas until the immediately following final reply', () => {
  const delta = { kind: 'stream_delta', provider: 'claude', sessionId: 'a', content: 'answer' };
  const final = { kind: 'text', provider: 'claude', sessionId: 'a', content: 'answer' };
  assert.deepEqual(collectAgentAssistantMessages([delta, { kind: 'stream_end', provider: 'claude', sessionId: 'a' }, final]), [final]);
});

test('Claude multi-block finals replace their matching deltas',()=>{
 const make=(kind:string,content?:string)=>({kind,provider:'claude',sessionId:'app',content});
 const rows=collectAgentAssistantMessages([make('stream_delta','A'),make('stream_end'),make('stream_end'),make('stream_delta','B'),make('stream_end'),make('text','A'),make('text','B')]) as any[];
 assert.deepEqual(rows.map(x=>x.content),['A','B']);
});


test('legacy Claude multi-block finals replace each streamed text block', () => {
  const final = { type: 'assistant', message: { content: [{ type: 'text', text: 'A' }, { type: 'text', text: 'B' }] } };
  assert.deepEqual(collectAgentAssistantMessages([
    { kind: 'stream_delta', provider: 'claude', content: 'A' },
    { kind: 'stream_end', provider: 'claude' },
    { kind: 'stream_delta', provider: 'claude', content: 'B' },
    { type: 'claude-response', data: final },
  ]), [final]);
});


test('a repeated final belongs to the current reply, not an earlier equal reply', () => {
  const first = { kind: 'stream_delta', provider: 'antigravity', sessionId: 'a', content: 'answer' };
  const final = { kind: 'text', provider: 'antigravity', sessionId: 'a', content: 'answer' };
  assert.deepEqual(collectAgentAssistantMessages([
    first, { kind: 'stream_end', provider: 'antigravity', sessionId: 'a' },
    { ...first, content: 'partial' }, final,
  ]), [first, final]);
});

test('tool-only legacy frames preserve streamed text', () => {
  const delta = { kind: 'stream_delta', provider: 'claude', content: 'keep this' };
  const final = { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'tool' }] } };
  assert.deepEqual(collectAgentAssistantMessages([delta, { type: 'claude-response', data: final }]), [delta, final]);
});

// Native message identity, rather than identical prose, owns streamed blocks.
test('Claude finals preserve an earlier equal-text delta-only reply', () => {
  const first = { kind: 'stream_delta', provider: 'claude', sessionId: 'a', content: 'answer', assistantReplyId: 'first', assistantBlockIndex: 0 };
  const partial = { ...first, content: 'partial', assistantReplyId: 'second' };
  const final = { ...partial, kind: 'text', content: 'answer' };
  assert.deepEqual(collectAgentAssistantMessages([first, { ...first, kind: 'stream_end' }, partial, final]), [first, final]);
});

test('Claude delayed equal-text block finals match native block indexes', () => {
  const row = (kind: string, index: number) => ({ kind, provider: 'claude', sessionId: 'a', content: 'same', assistantReplyId: 'reply', assistantBlockIndex: index });
  const a = row('text', 0), b = row('text', 2);
  assert.deepEqual(collectAgentAssistantMessages([row('stream_delta', 0), row('stream_end', 0), row('stream_delta', 2), row('stream_end', 2), a, b]), [a, b]);
});


test('single-block Claude finals consume blocks only within their native reply', () => {
  const row = (reply: string, index: number) => ({ kind: 'stream_delta', provider: 'claude', sessionId: 'a', content: 'same', assistantReplyId: reply, assistantBlockIndex: index });
  const first = row('earlier', 0);
  const final = { kind: 'text', provider: 'claude', sessionId: 'a', content: 'same', assistantReplyId: 'current' };
  assert.deepEqual(collectAgentAssistantMessages([first, row('current', 0), row('current', 2), final, final]), [first, final, final]);
});

for (const provider of ['antigravity', 'claude']) {
  test(`review regression: ${provider} final without deltas preserves a stopped reply`, () => {
    const first = { kind: 'stream_delta', provider, sessionId: 'a', content: 'first' };
    const final = { kind: 'text', provider, sessionId: 'a', content: 'second' };
    assert.deepEqual(collectAgentAssistantMessages([first, { ...first, kind: 'stream_end' }, final]), [first, final]);
    assert.deepEqual(collectAgentAssistantMessages([first, { ...first, kind: 'stream_end' }, { ...first, kind: 'text' }]), [{ ...first, kind: 'text' }]);
  });
}
