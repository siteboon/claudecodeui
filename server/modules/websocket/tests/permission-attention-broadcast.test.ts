import assert from 'node:assert/strict';
import test from 'node:test';

import {
  broadcastPermissionAttention,
  permissionAttentionSnapshot,
} from '@/modules/websocket/services/permission-attention-broadcast.service.js';
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

/**
 * The deltas only reach clients that were connected when they were sent. A
 * client that reconnects asks for this snapshot and replaces its state with it,
 * so the registry has to be the truth the deltas describe — kept up to date
 * before each frame goes out.
 */
const snapshotFor = (sessionId: string): Array<Record<string, unknown>> => {
  const frame = JSON.parse(permissionAttentionSnapshot()) as { sessions: Array<Record<string, unknown>> };
  return frame.sessions.filter((entry) => entry.sessionId === sessionId);
};

test('the snapshot lists what is waiting right now', () => {
  withConnection(() => {
    broadcastPermissionAttention(message({ sessionId: 'snap-1', requestId: 'r1', toolName: 'Bash' }));
    broadcastPermissionAttention(message({ sessionId: 'snap-1', requestId: 'r2' }));

    assert.deepEqual(
      snapshotFor('snap-1').map((entry) => [entry.requestId, entry.toolName]),
      [['r1', 'Bash'], ['r2', null]],
    );
  });
});

test('the snapshot drops requests that were answered or whose run ended', () => {
  withConnection(() => {
    broadcastPermissionAttention(message({ sessionId: 'snap-2', requestId: 'r1' }));
    broadcastPermissionAttention(message({ sessionId: 'snap-2', requestId: 'r2' }));

    broadcastPermissionAttention(message({ kind: 'permission_resolved', sessionId: 'snap-2', requestId: 'r1' }));
    assert.deepEqual(snapshotFor('snap-2').map((entry) => entry.requestId), ['r2']);

    broadcastPermissionAttention(message({ kind: 'complete', sessionId: 'snap-2' }));
    assert.deepEqual(snapshotFor('snap-2'), [], 'a finished run stops waiting for everything it raised');
  });
});

test('a request raised before any client connected is in the first snapshot', () => {
  // No connection is registered for the raise: the announcement is lost, and
  // only the snapshot can tell a client that arrives later.
  broadcastPermissionAttention(message({ sessionId: 'snap-3', requestId: 'late' }));

  assert.deepEqual(snapshotFor('snap-3').map((entry) => entry.requestId), ['late']);

  broadcastPermissionAttention(message({ kind: 'permission_cancelled', sessionId: 'snap-3', requestId: 'late' }));
});
