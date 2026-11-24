import assert from 'node:assert/strict';
import test from 'node:test';

import { broadcastPermissionAttention } from '@/modules/websocket/services/permission-attention-broadcast.service.js';
import { connectedClients } from '@/modules/websocket/services/websocket-state.service.js';
import type { NormalizedMessage } from '@/shared/types.js';

class FakeConnection {
  readyState = 1; // WS_OPEN_STATE
  frames: Array<Record<string, unknown>> = [];

  send(data: string): void {
    this.frames.push(JSON.parse(data) as Record<string, unknown>);
  }
}

function message(overrides: Partial<NormalizedMessage>): NormalizedMessage {
  return {
    id: 'row-1',
    sessionId: 'session-1',
    timestamp: '2026-11-24T00:00:00.000Z',
    provider: 'claude',
    kind: 'permission_request',
    ...overrides,
  } as NormalizedMessage;
}

/**
 * The session writer already forwards these events to the run's own audience.
 * What is under test here is the extra announcement: a request raised in a
 * session nobody is watching has to reach every client, or the sidebar can
 * never mark it and nothing can notify the user.
 */
function withConnection(run: (connection: FakeConnection) => void): void {
  const connection = new FakeConnection();
  connectedClients.add(connection as never);

  try {
    run(connection);
  } finally {
    connectedClients.delete(connection as never);
  }
}

test('a permission request is announced to every connected client', () => {
  withConnection((connection) => {
    broadcastPermissionAttention(message({ requestId: 'req-1', toolName: 'AskUserQuestion' }));

    assert.equal(connection.frames.length, 1);
    const frame = connection.frames[0];
    assert.equal(frame.kind, 'permission_attention');
    assert.equal(frame.sessionId, 'session-1');
    assert.equal(frame.requestId, 'req-1');
    assert.equal(frame.toolName, 'AskUserQuestion');
    // The request's own payload stays on the run stream; the announcement is
    // deliberately narrow enough for clients that never subscribed.
    assert.equal('input' in frame, false);
    assert.equal('context' in frame, false);
  });
});

test('resolving a request clears exactly that request', () => {
  withConnection((connection) => {
    broadcastPermissionAttention(message({ kind: 'permission_resolved', requestId: 'req-1' }));

    assert.equal(connection.frames.length, 1);
    assert.equal(connection.frames[0].kind, 'permission_attention_cleared');
    assert.equal(connection.frames[0].sessionId, 'session-1');
    assert.equal(connection.frames[0].requestId, 'req-1');
  });
});

test('a finished run clears the session even with no request id', () => {
  withConnection((connection) => {
    broadcastPermissionAttention(message({ kind: 'complete' }));

    assert.equal(connection.frames.length, 1);
    assert.equal(connection.frames[0].kind, 'permission_attention_cleared');
    assert.equal(connection.frames[0].requestId, null);
  });
});

test('a request without a request id cannot be tracked and is not announced', () => {
  withConnection((connection) => {
    broadcastPermissionAttention(message({ toolName: 'Bash' }));

    assert.deepEqual(connection.frames, []);
  });
});

test('ordinary run events are not announced', () => {
  withConnection((connection) => {
    for (const kind of ['text', 'tool_use', 'status', 'error'] as const) {
      broadcastPermissionAttention(message({ kind }));
    }

    assert.deepEqual(connection.frames, []);
  });
});

test('a provider event without a session id is not announced', () => {
  withConnection((connection) => {
    broadcastPermissionAttention(message({ sessionId: '', requestId: 'req-1' }));

    assert.deepEqual(connection.frames, []);
  });
});
