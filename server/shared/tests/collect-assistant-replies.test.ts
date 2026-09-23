import assert from 'node:assert/strict';
import test from 'node:test';

import { collectAssistantReplies, createNormalizedMessage } from '@/shared/utils.js';

const text = (content: string) => createNormalizedMessage({ kind: 'text', role: 'assistant', content, sessionId: 's', provider: 'claude' });
const delta = (content: string) => createNormalizedMessage({ kind: 'stream_delta', content, sessionId: 's', provider: 'opencode' });
const streamEnd = () => createNormalizedMessage({ kind: 'stream_end', sessionId: 's', provider: 'opencode' });

test('final assistant text rows are the replies, in order', () => {
  const first = text('one');
  const second = text('two');
  const replies = collectAssistantReplies([
    { type: 'status', message: 'Session started' },
    first,
    createNormalizedMessage({ kind: 'text', role: 'user', content: 'not a reply', sessionId: 's', provider: 'claude' }),
    createNormalizedMessage({ kind: 'tool_use', toolName: 'Read', sessionId: 's', provider: 'claude' }),
    second,
  ]);

  assert.deepEqual(replies, [first, second]);
});

test('deltas are joined into one reply per stream_end-delimited run and keep the first chunk envelope', () => {
  const firstChunk = delta('Hel');
  const replies = collectAssistantReplies([
    firstChunk,
    delta('lo.'),
    streamEnd(),
    delta('Bye.'),
    streamEnd(),
  ]);

  assert.deepEqual(replies.map((reply) => reply.content), ['Hello.', 'Bye.']);
  assert.equal(replies[0]?.id, firstChunk.id);
  assert.equal(replies[0]?.kind, 'text');
  assert.equal(replies[0]?.role, 'assistant');
  assert.equal(replies[0]?.provider, 'opencode');
  // The chunks the writer was sent are not mutated.
  assert.equal(firstChunk.content, 'Hel');
  assert.equal(firstChunk.kind, 'stream_delta');
});

test('any other event also ends a run of deltas, and a run without stream_end still counts', () => {
  const replies = collectAssistantReplies([
    delta('Before the tool.'),
    createNormalizedMessage({ kind: 'tool_use', toolName: 'read', sessionId: 's', provider: 'opencode' }),
    delta('After'),
    delta(' the tool.'),
  ]);

  assert.deepEqual(replies.map((reply) => reply.content), ['Before the tool.', 'After the tool.']);
});

test('final rows win over deltas so streamed partials are not counted twice', () => {
  const final = text('Hello.');
  const replies = collectAssistantReplies([delta('Hel'), delta('lo.'), streamEnd(), final]);

  assert.deepEqual(replies, [final]);
});

test('entries that are not normalized messages, and empty chunks, are skipped', () => {
  assert.deepEqual(collectAssistantReplies(['{"kind":"text"}', null, 42, [], { type: 'done' }, delta('')]), []);
});
