import assert from 'node:assert/strict';

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, test, vi } from 'vitest';

import { useChatRealtimeHandlers } from '@/modules/chat/hooks/useChatRealtimeHandlers';
import type { SessionStore } from '@/modules/chat/hooks/useSessionStore';
import { resetUserPreferences } from '@/shared/userSettings';
import type { PlanModeChange, ProjectSession, ServerEvent } from '@/shared/types';

/**
 * Plan mode is a session state the CLI changes on its own: Claude enters it by
 * calling EnterPlanMode, and an approved ExitPlanMode leaves it. The composer
 * sends its own mode with every message, so when it did not follow those
 * changes the next message silently undid them — a plan Claude was drafting
 * fell out of plan mode, and an approved plan went back into it.
 */

const okJson = (data: unknown) => Promise.resolve({ ok: true, json: async () => data });

vi.mock('@/shared/api', () => ({
  api: {
    user: {
      preferences: () => okJson({ success: true, preferences: {} }),
      savePreferences: () => okJson({ success: true, preferences: {} }),
    },
    providers: {
      models: () => okJson({ success: true, data: null }),
      capabilities: () => okJson({ success: true, data: null }),
      sessionActiveModel: () => okJson({ success: true, data: null }),
      setSessionActiveModel: () => okJson({ success: true, data: null }),
      setSessionActiveEffort: () => okJson({ success: true, data: null }),
      createModel: () => okJson({ success: true, data: null }),
      updateModel: () => okJson({ success: true, data: null }),
      removeModel: () => okJson({ success: true, data: null }),
    },
  },
}));

beforeEach(() => {
  localStorage.clear();
  resetUserPreferences();
});

afterEach(() => {
  vi.resetModules();
});

const VIEWED = 'viewed-session';

const renderHandlers = () => {
  let listener: ((event: ServerEvent) => void) | null = null;
  const changes: Array<[string, PlanModeChange]> = [];

  renderHook(() => useChatRealtimeHandlers({
    isActive: true,
    subscribe: (fn) => {
      listener = fn;
      return () => { listener = null; };
    },
    provider: 'claude',
    selectedSession: { id: VIEWED } as ProjectSession,
    currentSessionId: VIEWED,
    setTokenBudget: () => {},
    pendingPermissionRequests: [],
    setPendingPermissionRequests: () => {},
    streamTimerRef: { current: null },
    accumulatedStreamRef: { current: '' },
    lastSeqRef: { current: new Map() },
    statusCheckSentAtRef: { current: new Map() },
    requestLatestMessages: async () => {},
    sessionStore: { appendRealtime: () => {} } as unknown as SessionStore,
    onPlanModeChange: (sessionId, change) => { changes.push([sessionId, change]); },
  }));

  const dispatch = (event: Record<string, unknown>) => listener?.(event as unknown as ServerEvent);
  return { dispatch, changes };
};

const toolUse = (toolId: string, toolName: string, parentToolUseId?: string) => ({
  kind: 'tool_use',
  id: `use_${toolId}`,
  sessionId: VIEWED,
  provider: 'claude',
  timestamp: '2026-10-16T06:05:01.000Z',
  toolId,
  toolName,
  toolInput: {},
  ...(parentToolUseId ? { parentToolUseId } : {}),
});

const toolResult = (toolId: string, content: string, isError: boolean, parentToolUseId?: string) => ({
  kind: 'tool_result',
  id: `result_${toolId}`,
  sessionId: VIEWED,
  provider: 'claude',
  timestamp: '2026-10-16T06:05:02.000Z',
  toolId,
  content,
  isError,
  ...(parentToolUseId ? { parentToolUseId } : {}),
});

test('Claude entering plan mode on its own puts the session in plan mode', () => {
  const { dispatch, changes } = renderHandlers();

  dispatch(toolUse('toolu_enter', 'EnterPlanMode'));
  dispatch(toolResult('toolu_enter', 'Entered plan mode. You should now focus on exploring the codebase.', false));

  assert.deepEqual(changes, [[VIEWED, 'entered']]);
});

test('an approved plan takes the session out of plan mode', () => {
  const { dispatch, changes } = renderHandlers();

  dispatch(toolUse('toolu_exit', 'ExitPlanMode'));
  dispatch(toolResult('toolu_exit', 'User has approved your plan. You can now start coding.', false));

  assert.deepEqual(changes, [[VIEWED, 'exited']]);
});

test('a plan sent back for revision leaves the session in plan mode', () => {
  const { dispatch, changes } = renderHandlers();

  dispatch(toolUse('toolu_exit', 'ExitPlanMode'));
  dispatch(toolResult('toolu_exit', 'User asked to revise the plan', true));

  assert.deepEqual(changes, []);
});

test('a subagent planning inside its own run leaves the session mode alone', () => {
  const { dispatch, changes } = renderHandlers();

  dispatch(toolUse('toolu_sub_enter', 'EnterPlanMode', 'toolu_agent'));
  dispatch(toolResult('toolu_sub_enter', 'Entered plan mode.', false, 'toolu_agent'));
  dispatch(toolUse('toolu_sub_exit', 'ExitPlanMode', 'toolu_agent'));
  dispatch(toolResult('toolu_sub_exit', 'User has approved your plan.', false, 'toolu_agent'));

  assert.deepEqual(changes, []);
});

test('other tools never change the session mode', () => {
  const { dispatch, changes } = renderHandlers();

  dispatch(toolUse('toolu_read', 'Read'));
  dispatch(toolResult('toolu_read', 'file contents', false));

  assert.deepEqual(changes, []);
});

const renderProviderState = async (session: string) => {
  const { useChatProviderState } = await import('@/modules/chat/hooks/useChatProviderState');
  return renderHook(
    ({ sessionId }: { sessionId: string }) => useChatProviderState({
      selectedSession: { id: sessionId, __provider: 'claude' } as unknown as ProjectSession,
      selectedProject: null,
    }),
    { initialProps: { sessionId: session } },
  );
};

test('a session returns to the mode it had once its plan is approved', async () => {
  const { result } = await renderProviderState(VIEWED);
  act(() => { result.current.selectPermissionMode('acceptEdits'); });

  act(() => { result.current.applyPlanModeChange(VIEWED, 'entered'); });
  assert.equal(result.current.permissionMode, 'plan');

  act(() => { result.current.applyPlanModeChange(VIEWED, 'exited'); });
  assert.equal(result.current.permissionMode, 'acceptEdits');
});

test('a plan entered and approved in one burst of events leaves the session out of plan mode', async () => {
  // A refresh mid-run, a reconnect or a second tab replays the run's buffered
  // events back to back; both changes reach the same listener before React
  // renders again, so the second must not judge by the mode the first saw.
  const { result } = await renderProviderState(VIEWED);
  act(() => { result.current.selectPermissionMode('acceptEdits'); });

  const applyPlanModeChange = result.current.applyPlanModeChange;
  act(() => {
    applyPlanModeChange(VIEWED, 'entered');
    applyPlanModeChange(VIEWED, 'exited');
  });

  assert.equal(result.current.permissionMode, 'acceptEdits');
});

test('a plan change for a Claude session is kept while a provider without plan mode is on screen', async () => {
  const { useChatProviderState } = await import('@/modules/chat/hooks/useChatProviderState');
  const { result, rerender } = renderHook(
    ({ session }: { session: { id: string; __provider: string } }) => useChatProviderState({
      selectedSession: session as unknown as ProjectSession,
      selectedProject: null,
    }),
    { initialProps: { session: { id: 'codex-session', __provider: 'codex' } } },
  );

  act(() => { result.current.applyPlanModeChange('claude-session', 'entered', 'claude'); });

  rerender({ session: { id: 'claude-session', __provider: 'claude' } });
  assert.equal(result.current.permissionMode, 'plan');
});

test('plan mode picked by hand also ends when its plan is approved', async () => {
  const { result } = await renderProviderState(VIEWED);
  act(() => { result.current.selectPermissionMode('auto'); });
  act(() => { result.current.selectPermissionMode('plan'); });

  act(() => { result.current.applyPlanModeChange(VIEWED, 'exited'); });
  assert.equal(result.current.permissionMode, 'auto');
});

test('a plan change for a session that is not on screen is there when it is opened', async () => {
  const { result, rerender } = await renderProviderState(VIEWED);
  act(() => { result.current.selectPermissionMode('acceptEdits'); });

  act(() => { result.current.applyPlanModeChange('other-session', 'entered'); });
  assert.equal(result.current.permissionMode, 'acceptEdits', 'the session on screen keeps its mode');

  rerender({ sessionId: 'other-session' });
  assert.equal(result.current.permissionMode, 'plan');
});
