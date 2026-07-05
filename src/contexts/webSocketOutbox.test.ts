import assert from 'node:assert/strict';
import test from 'node:test';

import { createWebSocketOutbox } from './webSocketOutbox';

test('queues messages while disconnected and flushes them later', () => {
  const outbox = createWebSocketOutbox();
  const sent: string[] = [];

  outbox.enqueue({ type: 'chat.send', content: 'hello' });
  assert.equal(outbox.size(), 1);

  outbox.flush((payload) => sent.push(payload));

  assert.equal(outbox.size(), 0);
  assert.deepEqual(sent, [JSON.stringify({ type: 'chat.send', content: 'hello' })]);
});
