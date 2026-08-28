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

test('parseProtocolLine parses server request envelopes', () => {
  const message = parseProtocolLine(
    '{"id":"server-1","method":"session/requestRuntimePreferences","params":{"scope":"runtime-materialization"}}'
  );
  assert.deepEqual(message, {
    id: 'server-1',
    method: 'session/requestRuntimePreferences',
    params: { scope: 'runtime-materialization' },
  });
});

test('protocol client answers session/requestRuntimePreferences server requests', () => {
  const written: string[] = [];
  const client = protocolClient as unknown as {
    process: unknown;
    handleProtocolMessage(message: unknown): void;
  };
  const originalProcess = client.process;
  client.process = {
    stdin: {
      write: (line: string, _encoding: unknown, callback?: () => void) => {
        written.push(line);
        callback?.();
      },
    },
  };

  try {
    client.handleProtocolMessage({
      id: 'server-1',
      method: 'session/requestRuntimePreferences',
      params: { sessionId: 'sess_prefs', scope: 'runtime-materialization' },
    });

    assert.equal(written.length, 1);
    assert.deepEqual(JSON.parse(written[0]), {
      id: 'server-1',
      result: { nativeSearchEnhancementsEnabled: false },
    });
  } finally {
    client.process = originalProcess;
  }
});

test('protocol client rejects unknown server requests with method-not-found', () => {
  const written: string[] = [];
  const client = protocolClient as unknown as {
    process: unknown;
    handleProtocolMessage(message: unknown): void;
  };
  const originalProcess = client.process;
  client.process = {
    stdin: {
      write: (line: string, _encoding: unknown, callback?: () => void) => {
        written.push(line);
        callback?.();
      },
    },
  };

  try {
    client.handleProtocolMessage({
      id: 'server-9',
      method: 'interaction/requestPermission',
      params: { toolName: 'Bash' },
    });

    assert.equal(written.length, 1);
    const response = JSON.parse(written[0]) as { id: string; error: { code: number } };
    assert.equal(response.id, 'server-9');
    assert.equal(response.error.code, -32601);
  } finally {
    client.process = originalProcess;
  }
});

test('protocol client still resolves pending client requests by numeric id', () => {  const client = protocolClient as unknown as {
    pendingRequests: Map<number, {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
      timeout: NodeJS.Timeout | null;
    }>;
    handleProtocolMessage(message: unknown): void;
  };

  let resolved: unknown = null;
  client.pendingRequests.set(41, {
    resolve: (value) => {
      resolved = value;
    },
    reject: (error) => {
      throw error;
    },
    timeout: null,
  });

  try {
    client.handleProtocolMessage({ id: 41, result: { sessionId: 'sess_ok' } });

    assert.deepEqual(resolved, { sessionId: 'sess_ok' });
    assert.equal(client.pendingRequests.has(41), false);
  } finally {
    client.pendingRequests.delete(41);
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
