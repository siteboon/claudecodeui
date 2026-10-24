import assert from 'node:assert/strict';
import test from 'node:test';

import { readQueuedChatMessage } from '@/shared/utils.js';

test('a stored queued message is read with its text, options and attachments', () => {
  assert.deepEqual(
    readQueuedChatMessage({ content: 'A', options: { model: 'opus' }, attachments: [{ name: 'a.png' }] }),
    { content: 'A', options: { model: 'opus' }, attachments: [{ name: 'a.png' }] },
  );
});

test('legacy image-only descriptors are read as attachments', () => {
  assert.deepEqual(
    readQueuedChatMessage({ content: '', images: [{ name: 'shot.png' }] }),
    { content: '', attachments: [{ name: 'shot.png' }] },
  );
});

test('options that are not a plain object are dropped', () => {
  assert.deepEqual(readQueuedChatMessage({ content: 'A', options: ['plan'] }), { content: 'A', attachments: [] });
});

test('a message with nothing to send reads as absent', () => {
  assert.equal(readQueuedChatMessage({ content: '  ', attachments: [] }), null);
  assert.equal(readQueuedChatMessage(null), null);
  assert.equal(readQueuedChatMessage(['A']), null);
});
