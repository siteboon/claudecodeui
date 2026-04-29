import test from 'node:test';
import assert from 'node:assert/strict';

import { mergeServerMessages } from './mergeServerMessages';
import type { NormalizedMessage } from './useSessionStore';

function msg(id: string, content = 'hi'): NormalizedMessage {
  return {
    id,
    sessionId: 's',
    timestamp: `2026-01-01T00:00:${id.padStart(2, '0')}.000Z`,
    provider: 'claude',
    kind: 'text',
    role: 'assistant',
    content,
  };
}

test('mergeServerMessages: existing empty returns incoming', () => {
  const incoming = [msg('1'), msg('2')];
  assert.equal(mergeServerMessages([], incoming), incoming);
});

test('mergeServerMessages: incoming empty returns existing', () => {
  const existing = [msg('1'), msg('2')];
  assert.equal(mergeServerMessages(existing, []), existing);
});

test('mergeServerMessages: incoming has new id falls through to merge+sort', () => {
  const m1 = msg('1');
  const m2 = msg('2');
  const m3 = msg('3');
  const existing = [m1, m2];
  const incoming = [m2, m3];
  const result = mergeServerMessages(existing, incoming);
  assert.notEqual(result, existing);
  assert.equal(result.length, 3);
  assert.deepEqual(result.map(m => m.id), ['1', '2', '3']);
});

test('mergeServerMessages: same id but different reference falls through (edit case)', () => {
  const m1 = msg('1');
  const m2original = msg('2', 'original');
  const existing = [m1, m2original];
  const m2edited = msg('2', 'edited'); // new reference, same id
  const incoming = [m2edited];
  const result = mergeServerMessages(existing, incoming);
  assert.notEqual(result, existing);
  assert.equal(result.length, 2);
  const updated = result.find(m => m.id === '2')!;
  assert.equal(updated.content, 'edited');
});
