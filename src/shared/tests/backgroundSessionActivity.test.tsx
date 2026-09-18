import assert from 'node:assert/strict';

import { act, renderHook } from '@testing-library/react';
import { test } from 'vitest';

import { useSessionProtection } from '@/shared/hooks/useSessionProtection';
import type { BackgroundTaskSummary } from '@/shared/types';

/**
 * A session whose turn has ended while the agents, workflows or commands it
 * launched still run is busy — the CLI is held open for them — but it is not
 * producing a response: the composer must stay usable. The activity map
 * carries that as a `background` entry, which the running-sessions poll
 * keeps while the server lists it and drops when it no longer does.
 */

const task = (overrides: Partial<BackgroundTaskSummary> = {}): BackgroundTaskSummary => ({
  taskId: 'wxkj4kcvd',
  toolUseId: 'toolu_workflow_1',
  taskType: 'local_workflow',
  description: 'Audit the frontend',
  workflowName: 'audit',
  startedAt: Date.now() - 60_000,
  ...overrides,
});

test('a background-only entry is busy but not processing', () => {
  const { result } = renderHook(() => useSessionProtection());

  act(() => {
    result.current.markSessionBackground('session-1', [task()]);
  });

  const activity = result.current.getSessionActivity('session-1');
  assert.equal(activity?.background, true);
  assert.equal(activity?.canInterrupt, false);
  assert.deepEqual(activity?.tasks, [task({ startedAt: activity?.startedAt })]);
  assert.equal(result.current.isSessionProcessing('session-1'), false, 'no response is being produced');
  assert.ok(result.current.processingSessions.has('session-1'), 'but the session counts as busy');
});

test('the poll keeps a background entry it lists and drops one it no longer does', () => {
  const { result } = renderHook(() => useSessionProtection());
  const listed = task({ startedAt: Date.now() - 120_000 });

  act(() => {
    result.current.syncProcessingSessions([
      { sessionId: 'session-1', startedAt: listed.startedAt, canInterrupt: false, background: true, tasks: [listed] },
    ]);
  });
  assert.equal(result.current.getSessionActivity('session-1')?.background, true);
  assert.deepEqual(result.current.getSessionActivity('session-1')?.tasks, [listed]);
  assert.equal(result.current.isSessionProcessing('session-1'), false);

  act(() => {
    result.current.syncProcessingSessions([]);
  });
  assert.equal(result.current.getSessionActivity('session-1'), undefined, 'the task started two minutes ago: no local grace applies');
});

test('the idle acknowledgement of a subscribe leaves background work alone', () => {
  // The ack says no response is in flight, which is already true of a
  // background-only session; clearing it would blank the indicator on every
  // session open until the next poll.
  const { result } = renderHook(() => useSessionProtection());

  act(() => {
    result.current.markSessionBackground('session-1', [task()]);
    result.current.markSessionIdle('session-1', { ifStartedBefore: Date.now() + 1 });
  });
  assert.equal(result.current.getSessionActivity('session-1')?.background, true);

  act(() => {
    result.current.markSessionBackground('session-1', []);
  });
  assert.equal(result.current.getSessionActivity('session-1'), undefined, 'no task left marks it idle');
});

test('a new turn on a background session is processing again, with its own clock', () => {
  const { result } = renderHook(() => useSessionProtection());
  const earlier = task({ startedAt: Date.now() - 300_000 });

  act(() => {
    result.current.markSessionBackground('session-1', [earlier]);
  });
  const sendAt = Date.now();
  act(() => {
    result.current.markSessionProcessing('session-1', { statusText: null, canInterrupt: true });
  });

  const activity = result.current.getSessionActivity('session-1');
  assert.equal(result.current.isSessionProcessing('session-1'), true);
  assert.equal(activity?.background, undefined);
  assert.equal(activity?.canInterrupt, true);
  assert.ok((activity?.startedAt ?? 0) >= sendAt, 'the elapsed time and the stale-ack guard count from the send');
  assert.deepEqual(activity?.tasks, [earlier], 'the tasks keep running under the new turn');
});

test('a poll that still lists only background work does not demote a send made moments ago', () => {
  const { result } = renderHook(() => useSessionProtection());

  act(() => {
    result.current.markSessionProcessing('session-1');
    result.current.syncProcessingSessions([
      { sessionId: 'session-1', startedAt: Date.now() - 60_000, canInterrupt: false, background: true, tasks: [task()] },
    ]);
  });

  assert.equal(result.current.isSessionProcessing('session-1'), true);
});
