import assert from 'node:assert/strict';
import test from 'node:test';

import {
  encodeRequest,
  encodeResponse,
  isResponse,
  isServerRequest,
  parseProtocolLine,
  readNotificationSessionId,
} from '@/modules/providers/list/zcode/zcode-codec.js';

test('parseProtocolLine parses response envelopes', () => {
  const message = parseProtocolLine('{"id":7,"result":{"ok":true}}');
  assert.deepEqual(message, { id: 7, result: { ok: true } });
  assert.ok(isResponse(message!));
  assert.equal(isServerRequest(message!), false);
});

test('parseProtocolLine parses notification envelopes', () => {
  const message = parseProtocolLine('{"method":"session/event","params":{"sessionId":"sess_1"}}');
  assert.deepEqual(message, { method: 'session/event', params: { sessionId: 'sess_1' } });
});

test('parseProtocolLine parses server request envelopes', () => {
  const message = parseProtocolLine(
    '{"id":"server-1","method":"session/requestRuntimePreferences","params":{"scope":"runtime-materialization"}}'
  );
  assert.deepEqual(message, {
    id: 'server-1',
    method: 'session/requestRuntimePreferences',
    params: { scope: 'runtime-materialization' },
  });
  assert.ok(isServerRequest(message!));
});

test('parseProtocolLine rejects malformed input', () => {
  assert.equal(parseProtocolLine(''), null);
  assert.equal(parseProtocolLine('   '), null);
  assert.equal(parseProtocolLine('not json at all'), null);
  // JSON values without a protocol discriminator are not protocol messages.
  assert.equal(parseProtocolLine('42'), null);
  assert.equal(parseProtocolLine('{"foo":"bar"}'), null);
});

test('encodeRequest and encodeResponse produce newline-terminated lines', () => {
  assert.equal(encodeRequest({ id: 3, method: 'session/send', params: { content: 'hi' } }),
    '{"id":3,"method":"session/send","params":{"content":"hi"}}\n');
  assert.equal(encodeResponse('server-1', { result: { nativeSearchEnhancementsEnabled: false } }),
    '{"id":"server-1","result":{"nativeSearchEnhancementsEnabled":false}}\n');
});

test('readNotificationSessionId supports flat and nested payload layouts', () => {
  assert.equal(readNotificationSessionId({ sessionId: 'sess_flat' }), 'sess_flat');
  assert.equal(readNotificationSessionId({ event: { sessionId: 'sess_nested' } }), 'sess_nested');
  assert.equal(readNotificationSessionId({}), null);
  assert.equal(readNotificationSessionId(undefined), null);
});
