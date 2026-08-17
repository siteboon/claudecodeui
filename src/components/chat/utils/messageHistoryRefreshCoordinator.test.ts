import assert from 'node:assert/strict';
import test from 'node:test';

import { createMessageHistoryRefreshCoordinator } from './messageHistoryRefreshCoordinator';

test('hidden refresh signals make no requests and flush once on activation', async () => {
  let activeSessionId: string | null = null;
  const calls: string[] = [];
  const coordinator = createMessageHistoryRefreshCoordinator(
    async (sessionId) => { calls.push(sessionId); },
    (sessionId) => activeSessionId === sessionId,
  );

  await coordinator.request('session-1', false);
  await coordinator.request('session-1', false);
  await coordinator.request('session-1', false);
  assert.deepEqual(calls, []);

  activeSessionId = 'session-1';
  await coordinator.flushPending('session-1');
  assert.deepEqual(calls, ['session-1']);
});

test('concurrent active signals coalesce into one request plus one trailing refresh', async () => {
  let releaseFirst!: () => void;
  let callCount = 0;
  const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
  const coordinator = createMessageHistoryRefreshCoordinator(
    async () => {
      callCount++;
      if (callCount === 1) await firstGate;
    },
    () => true,
  );

  const first = coordinator.request('session-1');
  void coordinator.request('session-1');
  void coordinator.request('session-1');
  assert.equal(callCount, 1);

  releaseFirst();
  await first;
  assert.equal(callCount, 2);
});

test('hiding during an in-flight refresh defers the trailing request', async () => {
  let isVisible = true;
  let releaseFirst!: () => void;
  let callCount = 0;
  const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
  const coordinator = createMessageHistoryRefreshCoordinator(
    async () => {
      callCount++;
      if (callCount === 1) await firstGate;
    },
    () => isVisible,
  );

  const first = coordinator.request('session-1');
  isVisible = false;
  await coordinator.request('session-1', false);
  releaseFirst();
  await first;
  assert.equal(callCount, 1);
  assert.equal(coordinator.hasPending('session-1'), true);

  isVisible = true;
  await coordinator.flushPending('session-1');
  assert.equal(callCount, 2);
});

test('pending refreshes are isolated per session', async () => {
  let activeSessionId: string | null = null;
  const calls: string[] = [];
  const coordinator = createMessageHistoryRefreshCoordinator(
    async (sessionId) => { calls.push(sessionId); },
    (sessionId) => activeSessionId === sessionId,
  );

  await coordinator.request('session-a', false);
  await coordinator.request('session-b', false);
  activeSessionId = 'session-b';
  await coordinator.flushPending('session-b');
  assert.deepEqual(calls, ['session-b']);
  assert.equal(coordinator.hasPending('session-a'), true);

  activeSessionId = 'session-a';
  await coordinator.flushPending('session-a');
  assert.deepEqual(calls, ['session-b', 'session-a']);
});

test('an unhydrated session can discard a pending refresh in favor of initial load', async () => {
  let callCount = 0;
  const coordinator = createMessageHistoryRefreshCoordinator(
    async () => { callCount++; },
    () => true,
  );

  await coordinator.request('session-1', false);
  coordinator.discardPending('session-1');
  await coordinator.flushPending('session-1');

  assert.equal(callCount, 0);
});

test('a failed refresh remains pending without rejecting and can be retried', async () => {
  let callCount = 0;
  const coordinator = createMessageHistoryRefreshCoordinator(
    async () => {
      callCount++;
      if (callCount === 1) throw new Error('temporary failure');
    },
    () => true,
  );

  await coordinator.request('session-1');
  assert.equal(coordinator.hasPending('session-1'), true);

  await coordinator.flushPending('session-1');
  assert.equal(callCount, 2);
  assert.equal(coordinator.hasPending('session-1'), false);
});

test('a refresh deferred after visibility changes remains pending', async () => {
  let isVisible = true;
  let callCount = 0;
  const coordinator = createMessageHistoryRefreshCoordinator(
    async () => {
      callCount++;
      if (callCount === 1) {
        isVisible = false;
        return false;
      }
      return isVisible;
    },
    () => isVisible,
  );

  await coordinator.request('session-1', true);
  assert.equal(callCount, 1);
  assert.equal(coordinator.hasPending('session-1'), true);

  isVisible = true;
  await coordinator.flushPending('session-1');
  assert.equal(callCount, 2);
  assert.equal(coordinator.hasPending('session-1'), false);
});
