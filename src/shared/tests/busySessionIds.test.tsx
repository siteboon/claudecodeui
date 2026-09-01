import assert from 'node:assert/strict';

import { act, renderHook } from '@testing-library/react';
import React from 'react';
import { beforeEach, test, vi } from 'vitest';

/**
 * The sidebar renders a running dot per session row and a running count — it
 * never shows the status text. Subscribing it to the full activity map made it
 * re-render on every provider `status` frame, several times a second during a
 * run, because each frame rewrites an entry and allocates a new map.
 *
 * These tests pin the property that fixes it: the busy-id set keeps its identity
 * while membership is unchanged.
 */

vi.mock('@/shared/api', () => ({
  api: { runningSessions: () => Promise.resolve({ ok: false }) },
}));

const renderContexts = async () => {
  const {
    SessionProtectionProvider,
    useBusySessionIdSet,
    useProcessingSessions,
    useSessionProtectionActions,
  } = await import('@/shared/context/SessionProtectionContext');

  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(SessionProtectionProvider, null, children);

  return renderHook(
    () => ({
      busyIds: useBusySessionIdSet(),
      activity: useProcessingSessions(),
      actions: useSessionProtectionActions(),
    }),
    { wrapper },
  );
};

beforeEach(() => {
  vi.resetModules();
});

test('a status-text update changes the activity map but not the busy-id set', async () => {
  const { result } = await renderContexts();

  act(() => {
    result.current.actions.markSessionProcessing('session-1', { statusText: 'Thinking' });
  });
  const idsAfterStart = result.current.busyIds;
  const activityAfterStart = result.current.activity;
  assert.ok(idsAfterStart.has('session-1'));

  act(() => {
    result.current.actions.markSessionProcessing('session-1', { statusText: 'Running a tool' });
  });

  assert.notEqual(
    result.current.activity,
    activityAfterStart,
    'the activity map is expected to change — the status text did',
  );
  assert.equal(
    result.current.busyIds,
    idsAfterStart,
    'membership did not change, so the id set must keep its identity',
  );
});

test('starting a session adds it to the set', async () => {
  const { result } = await renderContexts();

  act(() => {
    result.current.actions.markSessionProcessing('session-1');
  });
  const idsWithOne = result.current.busyIds;

  act(() => {
    result.current.actions.markSessionProcessing('session-2');
  });

  assert.notEqual(result.current.busyIds, idsWithOne, 'membership changed');
  assert.deepEqual([...result.current.busyIds].sort(), ['session-1', 'session-2']);
});

test('finishing a session removes it from the set', async () => {
  const { result } = await renderContexts();

  act(() => {
    result.current.actions.markSessionProcessing('session-1');
    result.current.actions.markSessionProcessing('session-2');
  });

  act(() => {
    result.current.actions.markSessionIdle('session-1');
  });

  assert.deepEqual([...result.current.busyIds], ['session-2']);
});

test('the set starts empty', async () => {
  const { result } = await renderContexts();
  assert.equal(result.current.busyIds.size, 0);
});
