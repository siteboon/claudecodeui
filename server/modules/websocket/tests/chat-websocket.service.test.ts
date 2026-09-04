/**
 * Chat WebSocket Service Unit Tests
 *
 * Covers `emitRuntimeFailureFallback`: the safety net that turns a thrown
 * provider runtime into a visible error message, unless the runtime already
 * reported one itself.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import type { NormalizedMessage } from '@/shared/types.js';
import { emitRuntimeFailureFallback } from '@/modules/websocket/services/chat-websocket.service.js';

const createRun = (events: Array<Pick<NormalizedMessage, 'kind'>>) => {
  const sent: unknown[] = [];
  return {
    run: {
      events,
      writer: {
        send: (data: unknown) => sent.push(data),
      },
    },
    sent,
  };
};

test('runtime failure without a prior error event emits one error message', () => {
  const { run, sent } = createRun([]);

  emitRuntimeFailureFallback(run, {
    provider: 'antigravity',
    sessionId: 'app-sess-1',
    message: 'Failed to create Antigravity session: timeout',
  });

  assert.equal(sent.length, 1);
  const message = sent[0] as NormalizedMessage;
  assert.equal(message.kind, 'error');
  assert.equal(message.sessionId, 'app-sess-1');
  assert.equal(message.text, 'Failed to create Antigravity session: timeout');
});

test('runtime failure after a self-reported error is not duplicated', () => {
  const { run, sent } = createRun([{ kind: 'error' }]);

  emitRuntimeFailureFallback(run, {
    provider: 'claude',
    sessionId: 'app-sess-2',
    message: 'spawn claude ENOENT',
  });

  assert.equal(sent.length, 0);
});
