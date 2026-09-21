import assert from 'node:assert/strict';

import { renderHook, waitFor } from '@testing-library/react';
import React from 'react';
import { beforeEach, test, vi } from 'vitest';

/**
 * The running-sessions poll is what a refreshed page or a second tab learns a
 * session's background work from. Its task entries must reach the activity
 * map whole — including the `nested` flag that tells a task the session's own
 * turn launched from one its agents launched for themselves — or the pill
 * counts an agent's backgrounded command as a second task of the session's.
 */

const runningSessions = vi.fn();

vi.mock('@/shared/api', () => ({
  api: { runningSessions: () => runningSessions() },
}));

beforeEach(() => {
  vi.resetModules();
  runningSessions.mockReset();
});

test('the poll carries each task through whole, nested flag included', async () => {
  runningSessions.mockResolvedValue({
    ok: true,
    json: async () => ({
      data: {
        sessions: [{
          sessionId: 'held-session',
          provider: 'claude',
          startedAt: 1_700_000_000_000,
          lastSeq: 0,
          background: true,
          canInterrupt: false,
          tasks: [
            { taskId: 'w1', toolUseId: 'toolu_wf', taskType: 'local_workflow', description: 'one agent that waits', workflowName: 'probe', startedAt: 1_700_000_000_000 },
            { taskId: 'b1', toolUseId: 'toolu_inner', taskType: 'local_bash', description: 'Sleep for 60 seconds', startedAt: 1_700_000_001_000, nested: true },
          ],
        }],
      },
    }),
  });

  const { SessionProtectionProvider, useProcessingSessions } = await import('@/shared/context/SessionProtectionContext');
  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(SessionProtectionProvider, null, children);
  const { result } = renderHook(() => useProcessingSessions(), { wrapper });

  await waitFor(() => assert.ok(result.current.get('held-session')));
  const activity = result.current.get('held-session');
  assert.equal(activity?.background, true);
  assert.deepEqual(activity?.tasks?.map((task) => [task.taskId, task.nested ?? false]), [['w1', false], ['b1', true]]);
});

test('one task entry in a shape the client does not read hides only itself', async () => {
  // A newer server may list a task kind this client never learned; the
  // session's other work must still show.
  runningSessions.mockResolvedValue({
    ok: true,
    json: async () => ({
      data: {
        sessions: [{
          sessionId: 'held-session',
          provider: 'claude',
          startedAt: 1_700_000_000_000,
          lastSeq: 0,
          background: true,
          canInterrupt: false,
          tasks: [
            { taskId: 'w1', toolUseId: 'toolu_wf', taskType: 'local_workflow', description: 'one agent that waits', startedAt: 1_700_000_000_000 },
            { taskId: 'x1', toolUseId: 'toolu_x', taskType: 'remote_agent', description: 'Unreadable', startedAt: 'yesterday' },
          ],
        }],
      },
    }),
  });

  const { SessionProtectionProvider, useProcessingSessions } = await import('@/shared/context/SessionProtectionContext');
  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(SessionProtectionProvider, null, children);
  const { result } = renderHook(() => useProcessingSessions(), { wrapper });

  await waitFor(() => assert.ok(result.current.get('held-session')));
  assert.deepEqual(result.current.get('held-session')?.tasks?.map((task) => task.taskId), ['w1']);
});
