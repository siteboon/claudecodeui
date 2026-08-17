import assert from 'node:assert/strict';
import test from 'node:test';

import {
  parseProtocolLine,
  protocolClient,
} from '@/modules/providers/list/zcode/zcode-protocol.client.js';

test('parseProtocolLine parses response envelopes', () => {
  const message = parseProtocolLine('{"id":7,"result":{"ok":true}}');
  assert.deepEqual(message, { id: 7, result: { ok: true } });
});

test('parseProtocolLine parses notification envelopes', () => {
  const message = parseProtocolLine('{"method":"session/event","params":{"sessionId":"sess_1"}}');
  assert.deepEqual(message, { method: 'session/event', params: { sessionId: 'sess_1' } });
});

test('parseProtocolLine rejects malformed input', () => {
  assert.equal(parseProtocolLine(''), null);
  assert.equal(parseProtocolLine('   '), null);
  assert.equal(parseProtocolLine('not json at all'), null);
  // JSON values without a protocol discriminator are not protocol messages.
  assert.equal(parseProtocolLine('42'), null);
  assert.equal(parseProtocolLine('{"foo":"bar"}'), null);
});

test('protocol client routes session/event notifications by flat sessionId', () => {
  const received: unknown[] = [];
  const listener = (notification: { method: string; params: unknown }) => {
    received.push(notification);
  };

  protocolClient.addSessionListener('sess_route_flat', listener);
  try {
    (protocolClient as unknown as {
      handleProtocolMessage(message: unknown): void;
    }).handleProtocolMessage({
      method: 'session/event',
      params: { sessionId: 'sess_route_flat', type: 'model_streaming' },
    });

    // A notification for another session must not reach the listener.
    (protocolClient as unknown as {
      handleProtocolMessage(message: unknown): void;
    }).handleProtocolMessage({
      method: 'session/event',
      params: { sessionId: 'sess_other', type: 'model_streaming' },
    });

    assert.equal(received.length, 1);
    assert.equal((received[0] as { params: { sessionId: string } }).params.sessionId, 'sess_route_flat');
  } finally {
    protocolClient.removeSessionListener('sess_route_flat', listener);
  }
});

test('protocol client routes session/event notifications by nested event sessionId', () => {
  const received: unknown[] = [];
  const listener = (notification: { method: string; params: unknown }) => {
    received.push(notification);
  };

  protocolClient.addSessionListener('sess_route_nested', listener);
  try {
    (protocolClient as unknown as {
      handleProtocolMessage(message: unknown): void;
    }).handleProtocolMessage({
      method: 'session/event',
      params: { event: { sessionId: 'sess_route_nested', type: 'turn_complete' } },
    });

    assert.equal(received.length, 1);
  } finally {
    protocolClient.removeSessionListener('sess_route_nested', listener);
  }
});

test('protocol client ignores non-session notifications', () => {
  const listener = () => {
    throw new Error('listener must not be called');
  };

  protocolClient.addSessionListener('sess_ignore', listener);
  try {
    (protocolClient as unknown as {
      handleProtocolMessage(message: unknown): void;
    }).handleProtocolMessage({
      method: 'workspace/stateChanged',
      params: { sessionId: 'sess_ignore' },
    });
  } finally {
    protocolClient.removeSessionListener('sess_ignore', listener);
  }
});
