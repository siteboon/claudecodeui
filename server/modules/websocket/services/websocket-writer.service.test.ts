import assert from 'node:assert/strict';
import { test } from 'node:test';

import { WebSocketWriter } from '@/modules/websocket/services/websocket-writer.service.js';

const dummyWs = {
  readyState: 1,
  send: () => {},
} as unknown as Parameters<typeof WebSocketWriter['prototype']['updateWebSocket']>[0];

test('WebSocketWriter starts with null preferredAccountId', () => {
  const writer = new WebSocketWriter(dummyWs);
  assert.equal(writer.getPreferredAccountId(), null);
});

test('WebSocketWriter persists preferredAccountId after set', () => {
  const writer = new WebSocketWriter(dummyWs);
  writer.setPreferredAccountId('conn-123');
  assert.equal(writer.getPreferredAccountId(), 'conn-123');
});

test('WebSocketWriter trims whitespace around preferredAccountId', () => {
  const writer = new WebSocketWriter(dummyWs);
  writer.setPreferredAccountId('  conn-456  ');
  assert.equal(writer.getPreferredAccountId(), 'conn-456');
});

test('WebSocketWriter clears preferredAccountId on null', () => {
  const writer = new WebSocketWriter(dummyWs);
  writer.setPreferredAccountId('conn-789');
  writer.setPreferredAccountId(null);
  assert.equal(writer.getPreferredAccountId(), null);
});

test('WebSocketWriter clears preferredAccountId on empty string', () => {
  const writer = new WebSocketWriter(dummyWs);
  writer.setPreferredAccountId('conn-abc');
  writer.setPreferredAccountId('');
  assert.equal(writer.getPreferredAccountId(), null);
});

test('WebSocketWriter clears preferredAccountId on whitespace-only string', () => {
  const writer = new WebSocketWriter(dummyWs);
  writer.setPreferredAccountId('conn-abc');
  writer.setPreferredAccountId('   ');
  assert.equal(writer.getPreferredAccountId(), null);
});
