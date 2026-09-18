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
    requestLatestMessages: async () => {},
    sessionStore: {
      appendRealtime: (_sessionId: string, msg: NormalizedMessage) => { stored.push(msg); },
      getMessages: () => stored,
      updateStreaming: () => {},
      finalizeStreaming: () => {},
    } as unknown as SessionStore,
  }));

  const dispatch = (event: ServerEvent) => listener?.(event);
  return { dispatch, log };
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
  const { dispatch, log } = renderHandlers();

  workflowLaunch().forEach(dispatch);
  dispatch(event({ kind: 'complete', success: true }));
  // Progress while the work runs changes nothing about the set.
  dispatch(event({ kind: 'task_status', event: 'progress', taskId: 'wxkj4kcvd', toolUseId: 'toolu_workflow_1', summary: 'Verify 3/6' }));
  assert.equal(log.length, 1);

  dispatch(event({ kind: 'task_status', event: 'notification', taskId: 'wxkj4kcvd', toolUseId: 'toolu_workflow_1', status: 'completed', summary: 'done' }));

  assert.deepEqual(log[1], { sessionId: 'viewed-session', tasks: [] });
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
    toolUseResult: { isAsync: true, status: 'async_launched', agentId: 'a1', taskId: 'agent-task-1' },
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
    subagent: { id: 'a2', description: 'Unnamed', status: 'running' },
  }));
  dispatch(event({ kind: 'complete', success: true }));

  assert.deepEqual(log, [{
    sessionId: 'viewed-session',
    tasks: [
      { taskId: 'agent-task-1', toolUseId: 'toolu_agent_1', taskType: 'local_agent', description: 'Survey the repo', startedAt: Date.parse('2026-08-21T10:32:10.000Z') },
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
