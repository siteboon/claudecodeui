import assert from 'node:assert/strict';

import { renderHook } from '@testing-library/react';
import { test } from 'vitest';

import { useChatRealtimeHandlers } from '@/modules/chat/hooks/useChatRealtimeHandlers';
import type { BackgroundTaskSummary, NormalizedMessage, ProjectSession, ServerEvent, SessionActivity } from '@/shared/types';
import type { SessionStore } from '@/modules/chat/hooks/useSessionStore';

/**
 * The turn's `complete` used to mark the session idle outright, although the
 * runtime keeps the CLI open while the agents, workflows or commands the turn
 * launched are still running. The handler now reads the session's task events
 * — the same fold the transcript's cards draw from — and leaves the session
 * as background work with those tasks, until their notifications empty the
 * set, without waiting for the running-sessions poll.
 */

type ActivityLog = Array<{ sessionId: string; tasks: BackgroundTaskSummary[] } | { sessionId: string; idle: true }>;

const renderHandlers = () => {
  let listener: ((event: ServerEvent) => void) | null = null;
  const stored: NormalizedMessage[] = [];
  const log: ActivityLog = [];
  const syncs: string[] = [];
  // The activity map as the provider would hold it, so the handler's read of
  // "is this session background-only" sees its own earlier report.
  const activityBySession = new Map<string, SessionActivity>();

  renderHook(() => useChatRealtimeHandlers({
    isActive: true,
    subscribe: (fn) => {
      listener = fn;
      return () => { listener = null; };
    },
    provider: 'claude',
    selectedSession: { id: 'viewed-session' } as ProjectSession,
    currentSessionId: 'viewed-session',
    setTokenBudget: () => {},
    pendingPermissionRequests: [],
    setPendingPermissionRequests: () => {},
    streamTimerRef: { current: null },
    accumulatedStreamRef: { current: '' },
    lastSeqRef: { current: new Map() },
    statusCheckSentAtRef: { current: new Map() },
    onSessionIdle: (sessionId) => {
      if (sessionId) {
        activityBySession.delete(sessionId);
        log.push({ sessionId, idle: true });
      }
    },
    onSessionBackground: (sessionId, tasks) => {
      if (tasks.length > 0) {
        activityBySession.set(sessionId, { statusText: null, canInterrupt: false, startedAt: tasks[0].startedAt, background: true, tasks });
      } else {
        activityBySession.delete(sessionId);
      }
      log.push({ sessionId, tasks });
    },
    getSessionActivity: (sessionId) => activityBySession.get(sessionId),
    requestLatestMessages: async (sessionId) => { syncs.push(sessionId); },
    sessionStore: {
      appendRealtime: (_sessionId: string, msg: NormalizedMessage) => { stored.push(msg); },
      getMessages: () => stored,
      updateStreaming: () => {},
      finalizeStreaming: () => {},
    } as unknown as SessionStore,
  }));

  const dispatch = (event: ServerEvent) => listener?.(event);
  return { dispatch, log, syncs, stored };
};

const event = (fields: Record<string, unknown>): ServerEvent => ({
  id: `event-${Math.random()}`,
  sessionId: 'viewed-session',
  provider: 'claude',
  timestamp: '2026-08-21T10:32:10.000Z',
  ...fields,
} as unknown as ServerEvent);

const workflowLaunch = () => [
  event({ kind: 'tool_use', toolId: 'toolu_workflow_1', toolName: 'Workflow', toolInput: { script: '', description: 'Audit the frontend' } }),
  event({ kind: 'tool_result', toolId: 'toolu_workflow_1', content: 'Workflow launched in background', toolUseResult: { status: 'async_launched', taskId: 'wxkj4kcvd' } }),
  event({ kind: 'task_status', event: 'started', taskId: 'wxkj4kcvd', toolUseId: 'toolu_workflow_1', taskType: 'local_workflow', workflowName: 'audit', description: 'Audit the frontend' }),
];

test('a turn that ends with a task still running leaves the session as background work', () => {
  const { dispatch, log } = renderHandlers();

  workflowLaunch().forEach(dispatch);
  dispatch(event({ kind: 'complete', success: true }));

  assert.deepEqual(log, [{
    sessionId: 'viewed-session',
    tasks: [{
      taskId: 'wxkj4kcvd',
      toolUseId: 'toolu_workflow_1',
      taskType: 'local_workflow',
      description: 'Audit the frontend',
      workflowName: 'audit',
      startedAt: Date.parse('2026-08-21T10:32:10.000Z'),
    }],
  }]);
});

test('the task\'s notification then marks the background-only session idle', () => {
  const { dispatch, log, syncs } = renderHandlers();

  workflowLaunch().forEach(dispatch);
  dispatch(event({ kind: 'complete', success: true }));
  // Progress while the work runs changes nothing about the set.
  dispatch(event({ kind: 'task_status', event: 'progress', taskId: 'wxkj4kcvd', toolUseId: 'toolu_workflow_1', summary: 'Verify 3/6' }));
  assert.equal(log.length, 1);
  const syncsBefore = syncs.length;

  dispatch(event({ kind: 'task_status', event: 'notification', taskId: 'wxkj4kcvd', toolUseId: 'toolu_workflow_1', status: 'completed', summary: 'done' }));

  assert.deepEqual(log[1], { sessionId: 'viewed-session', tasks: [] });
  // The notification says only that the task settled; its result reaches the
  // card through the history reader, so the viewed session syncs at once.
  assert.deepEqual(syncs.slice(syncsBefore), ['viewed-session']);
});

test('a turn that ends with nothing running, or is aborted, leaves the session idle', () => {
  const { dispatch, log } = renderHandlers();

  dispatch(event({ kind: 'text', role: 'assistant', content: 'Done.' }));
  dispatch(event({ kind: 'complete', success: true }));
  assert.deepEqual(log, [{ sessionId: 'viewed-session', tasks: [] }]);

  // An abort releases the CLI and takes the launched work down with it.
  workflowLaunch().forEach(dispatch);
  dispatch(event({ kind: 'complete', aborted: true }));
  assert.deepEqual(log[1], { sessionId: 'viewed-session', idle: true });
});

test('tasks the history load left running count too, described by their launch', () => {
  // The page loaded after their start events went by: the backend's word
  // from the journal is what says they still run, and the acknowledgement is
  // what names them. A launch nothing has named is left to the poll.
  const { dispatch, log } = renderHandlers();

  dispatch(event({
    kind: 'tool_use', toolId: 'toolu_agent_1', toolName: 'Agent', toolInput: { description: 'Survey the repo', prompt: '…' },
    subagent: { id: 'a1', description: 'Survey the repo', status: 'running' },
  }));
  dispatch(event({
    kind: 'tool_result', toolId: 'toolu_agent_1', content: '',
    // The real acknowledgement: no `taskId`, the agent's id is the task's.
    toolUseResult: { isAsync: true, status: 'async_launched', agentId: 'a1' },
  }));
  dispatch(event({
    kind: 'tool_use', toolId: 'toolu_workflow_1', toolName: 'Workflow', toolInput: { script: '' },
    workflow: { runId: 'wf_1', name: 'audit', status: 'running', agents: [], agentCounts: { total: 0, completed: 0, failed: 0, running: 0, stopped: 0 } },
  }));
  dispatch(event({
    kind: 'tool_result', toolId: 'toolu_workflow_1', content: '',
    toolUseResult: { status: 'async_launched', taskId: 'wxkj4kcvd', taskType: 'local_workflow', workflowName: 'audit' },
  }));
  dispatch(event({
    kind: 'tool_use', toolId: 'toolu_agent_2', toolName: 'Agent', toolInput: { description: 'Unnamed', prompt: '…' },
    subagent: { id: '', description: 'Unnamed', status: 'running' },
  }));
  dispatch(event({ kind: 'complete', success: true }));

  assert.deepEqual(log, [{
    sessionId: 'viewed-session',
    tasks: [
      { taskId: 'a1', toolUseId: 'toolu_agent_1', taskType: 'local_agent', description: 'Survey the repo', startedAt: Date.parse('2026-08-21T10:32:10.000Z') },
      { taskId: 'wxkj4kcvd', toolUseId: 'toolu_workflow_1', taskType: 'local_workflow', description: '', workflowName: 'audit', startedAt: Date.parse('2026-08-21T10:32:10.000Z') },
    ],
  }]);
});

test('a task ending during a turn in flight is left to the turn\'s complete', () => {
  const { dispatch, log } = renderHandlers();

  workflowLaunch().forEach(dispatch);
  dispatch(event({ kind: 'task_status', event: 'notification', taskId: 'wxkj4kcvd', toolUseId: 'toolu_workflow_1', status: 'completed', summary: 'done' }));

  assert.deepEqual(log, [], 'the session is processing, not background-only');
});

test('a refused stop request does not idle the session it was sent on', () => {
  // The ✕ on a chip whose task just settled answers NO_SUCH_TASK; a response
  // may be streaming on that session, and it must keep its spinner.
  const { dispatch, log } = renderHandlers();

  dispatch(event({ kind: 'protocol_error', code: 'NO_SUCH_TASK', error: 'Session has no such task' }));
  dispatch(event({ kind: 'protocol_error', code: 'TASK_ID_REQUIRED', error: 'chat.stop-task requires a taskId' }));
  assert.deepEqual(log, []);

  // Any other rejection still means the send never became a run.
  dispatch(event({ kind: 'protocol_error', code: 'SESSION_NOT_FOUND', error: 'gone' }));
  assert.deepEqual(log, [{ sessionId: 'viewed-session', idle: true }]);
});

test('a stop refused for a task whose end never arrived settles its chip instead of erroring', () => {
  const { dispatch, log, stored } = renderHandlers();

  // A backgrounded command; its started event never reached this client.
  dispatch(event({ kind: 'tool_use', toolId: 'toolu_bash_1', toolName: 'Bash', toolInput: { command: 'sleep 600', run_in_background: true } }));
  dispatch(event({ kind: 'tool_result', toolId: 'toolu_bash_1', content: 'Running in background', toolUseResult: { backgroundTaskId: 'bjxsjif0e' } }));
  dispatch(event({ kind: 'task_status', event: 'progress', taskId: 'bjxsjif0e', toolUseId: 'toolu_bash_1', taskType: 'local_bash' }));
  dispatch(event({ kind: 'complete', success: true }));
  assert.equal((log.at(-1) as { tasks: BackgroundTaskSummary[] }).tasks.length, 1);

  dispatch(event({ kind: 'protocol_error', code: 'NO_SUCH_TASK', error: 'no running background task', taskId: 'bjxsjif0e' }));

  assert.deepEqual(log.at(-1), { sessionId: 'viewed-session', tasks: [] });
  assert.equal(stored.some((message) => message.kind === 'error'), false);
  assert.equal(stored.at(-1)?.kind, 'task_status');
  assert.equal(stored.at(-1)?.toolUseId, 'toolu_bash_1');
  assert.equal(stored.at(-1)?.status, 'stopped');
});

test('a stop refused after the task\'s own end arrived adds no error row', () => {
  const { dispatch, stored } = renderHandlers();

  workflowLaunch().forEach(dispatch);
  dispatch(event({ kind: 'task_status', event: 'notification', taskId: 'wxkj4kcvd', toolUseId: 'toolu_workflow_1', status: 'completed', summary: 'done' }));
  dispatch(event({ kind: 'protocol_error', code: 'NO_SUCH_TASK', error: 'no running background task', taskId: 'wxkj4kcvd' }));

  assert.equal(stored.some((message) => message.kind === 'error'), false);
});

test('a refused stop for a task with no card here is still reported', () => {
  const { dispatch, stored } = renderHandlers();

  dispatch(event({ kind: 'protocol_error', code: 'NO_SUCH_TASK', error: 'no running background task', taskId: 'unknown' }));

  assert.equal(stored.at(-1)?.kind, 'error');
});

test('a refused stop for a task whose row has no status yet is still reported', () => {
  const { dispatch, stored } = renderHandlers();

  // Only the launch acknowledgement: the row says nothing about the task.
  dispatch(event({ kind: 'tool_use', toolId: 'toolu_bash_1', toolName: 'Bash', toolInput: { command: 'sleep 600', run_in_background: true } }));
  dispatch(event({ kind: 'tool_result', toolId: 'toolu_bash_1', content: 'Running in background', toolUseResult: { backgroundTaskId: 'bjxsjif0e' } }));
  dispatch(event({ kind: 'protocol_error', code: 'NO_SUCH_TASK', error: 'no running background task', taskId: 'bjxsjif0e' }));

  assert.equal(stored.at(-1)?.kind, 'error');
});

test('a refused stop settles the running row when an earlier row of the same task has settled', () => {
  const { dispatch, stored } = renderHandlers();

  // A resumed agent: the first call settled, the second runs under the same id.
  dispatch(event({ kind: 'tool_use', toolId: 'toolu_agent_1', toolName: 'Agent', toolInput: { description: 'Survey' } }));
  dispatch(event({ kind: 'task_status', event: 'started', taskId: 'a1', toolUseId: 'toolu_agent_1', taskType: 'local_agent' }));
  dispatch(event({ kind: 'task_status', event: 'notification', taskId: 'a1', toolUseId: 'toolu_agent_1', status: 'completed' }));
  dispatch(event({ kind: 'tool_use', toolId: 'toolu_agent_2', toolName: 'Agent', toolInput: { description: 'Survey again' } }));
  dispatch(event({ kind: 'task_status', event: 'started', taskId: 'a1', toolUseId: 'toolu_agent_2', taskType: 'local_agent' }));
  dispatch(event({ kind: 'protocol_error', code: 'NO_SUCH_TASK', error: 'no running background task', taskId: 'a1' }));

  assert.equal(stored.at(-1)?.toolUseId, 'toolu_agent_2');
  assert.equal(stored.at(-1)?.status, 'stopped');
});

test('a refused stop settles every running row of the task', () => {
  const { dispatch, log, stored } = renderHandlers();

  for (const toolId of ['toolu_agent_1', 'toolu_agent_2']) {
    dispatch(event({ kind: 'tool_use', toolId, toolName: 'Agent', toolInput: { description: 'Survey' } }));
    dispatch(event({ kind: 'task_status', event: 'started', taskId: 'a1', toolUseId: toolId, taskType: 'local_agent' }));
  }
  dispatch(event({ kind: 'complete', success: true }));
  dispatch(event({ kind: 'protocol_error', code: 'NO_SUCH_TASK', error: 'no running background task', taskId: 'a1' }));

  assert.deepEqual(log.at(-1), { sessionId: 'viewed-session', tasks: [] });
  assert.deepEqual(
    stored.filter((message) => message.status === 'stopped').map((message) => message.toolUseId),
    ['toolu_agent_1', 'toolu_agent_2'],
  );
});
