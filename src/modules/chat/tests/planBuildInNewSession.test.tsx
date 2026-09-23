import assert from 'node:assert/strict';

import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, test, vi } from 'vitest';

import '@/modules/i18n';
import PermissionContext from '@/modules/chat/context/PermissionContext';
import { useChatComposerState } from '@/modules/chat/hooks/useChatComposerState';
import { usePlanBuildShortcut } from '@/modules/chat/hooks/usePlanBuildShortcut';
import { PlanDisplay } from '@/modules/chat/tools/PlanDisplay';
import { UiPreferencesProvider } from '@/shared/context/UiPreferencesContext';
import { resetUserPreferences, writeUserPreference } from '@/shared/userSettings';
import type {
  ChatMessage,
  PendingPermissionRequest,
  PermissionMode,
  Project,
  ProjectSession,
  SessionEstablishedContext,
} from '@/shared/types';

/**
 * Issue #1403: an approved plan can be built in a new session, like the Claude
 * CLI's "clear context" approval, so the build starts with the plan alone
 * instead of everything planning read along the way. The plan card's Build is a
 * split button whose main half (and ⌘↩) follows the "Build approved plans in"
 * setting; its menu offers the other place.
 */

const PLAN = '# Add a hello file\n\n1. Create hello.txt containing "hi".';
const PLAN_REQUEST: PendingPermissionRequest = {
  requestId: 'req-plan',
  toolName: 'ExitPlanMode',
  input: { plan: PLAN, planFilePath: '/home/u/.claude/plans/p.md' },
  sessionId: 'planning-session',
};

const PROJECT: Project = { projectId: 'project-1', displayName: 'Project One', fullPath: '/work/project-one' };
const PLANNING_SESSION: ProjectSession = { id: 'planning-session', summary: 'Plan the hello file' };

type Sent = { type: string; [key: string]: unknown };

const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json' },
});

let createSessionResponse: () => Response | Promise<Response>;
let createSessionCalls: Array<Record<string, unknown>>;

beforeEach(() => {
  localStorage.clear();
  resetUserPreferences();
  createSessionCalls = [];
  createSessionResponse = () => jsonResponse({ success: true, data: { sessionId: 'built-session', sessionName: 'Add a hello file' } });
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (String(url).endsWith('/api/providers/sessions') && init?.method === 'POST') {
      createSessionCalls.push(JSON.parse(String(init.body)));
      return createSessionResponse();
    }
    return jsonResponse([]);
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
  resetUserPreferences();
});

// ---------------------------------------------------------------------------
// The composer's "build in a new session" action
// ---------------------------------------------------------------------------

const renderComposer = () => {
  const sent: Sent[] = [];
  const added: Array<{ message: ChatMessage; targetSessionId?: string }> = [];
  const established: Array<{ sessionId: string; context: SessionEstablishedContext }> = [];
  const pinnedModes: Array<{ sessionId: string; mode: PermissionMode }> = [];
  const processing: string[] = [];
  // The open session's pending approvals, as ChatInterface's state holds them.
  const pending = { current: [PLAN_REQUEST] as PendingPermissionRequest[] };

  const view = renderHook(({ openSession }: { openSession: ProjectSession }) =>
    useChatComposerState({
      selectedProject: PROJECT,
      selectedSession: openSession,
      currentSessionId: openSession.id,
      provider: 'claude',
      // The planning session's composer is still in plan mode when Build is pressed.
      permissionMode: 'plan',
      cyclePermissionMode: () => undefined,
      resolvePermissionModeForProvider: (_provider, mode) => mode as PermissionMode,
      currentProviderModel: 'test-model',
      currentProviderEffort: 'medium',
      isLoading: true,
      processingSessions: new Map(),
      canAbortSession: true,
      tokenBudget: null,
      sendMessage: (message) => { sent.push(message as Sent); },
      onSessionEstablished: (sessionId, context) => { established.push({ sessionId, context }); },
      onSessionProcessing: (sessionId) => { processing.push(String(sessionId)); },
      scrollToBottom: () => undefined,
      addMessage: (message, targetSessionId) => { added.push({ message, targetSessionId }); },
      setIsUserScrolledUp: () => undefined,
      setPendingPermissionRequests: (update) => {
        pending.current = typeof update === 'function' ? update(pending.current) : update;
      },
      rememberSessionPermissionMode: (sessionId, mode) => { pinnedModes.push({ sessionId, mode }); },
    }),
    { initialProps: { openSession: PLANNING_SESSION } },
  );

  return { view, sent, added, established, pinnedModes, processing, pending };
};

/** A session allocation the test lets through (or fails) when it chooses. */
const holdSessionAllocation = () => {
  let release: (response: Response) => void = () => undefined;
  createSessionResponse = () => new Promise<Response>((resolve) => { release = resolve; });
  return {
    succeed: () => release(jsonResponse({ success: true, data: { sessionId: 'built-session', sessionName: 'Add a hello file' } })),
    fail: () => release(jsonResponse({ success: false }, 500)),
  };
};

test('building in a new session stops the planning run and sends the plan to a new session in default mode', async () => {
  const { view, sent, added, established, pinnedModes, processing } = renderComposer();

  await act(async () => { await view.result.current.handleBuildPlanInNewSession(PLAN_REQUEST); });

  // A new session is allocated in the same project, named after the plan's heading.
  assert.equal(createSessionCalls.length, 1);
  assert.deepEqual(createSessionCalls[0], {
    provider: 'claude',
    projectPath: '/work/project-one',
    initialMessage: 'Add a hello file',
  });

  // The planning run is told no, with an instruction to stop, so it does not
  // build the plan as well.
  const responses = sent.filter((message) => message.type === 'chat.permission-response');
  assert.equal(responses.length, 1);
  assert.equal(responses[0].requestId, 'req-plan');
  assert.equal(responses[0].allow, false);
  assert.match(String(responses[0].message), /building it in a new session/);
  assert.match(String(responses[0].message), /do not call ExitPlanMode again/);

  // The plan is the new session's first message, sent in the mode Build uses.
  const sends = sent.filter((message) => message.type === 'chat.send');
  assert.equal(sends.length, 1);
  assert.equal(sends[0].sessionId, 'built-session');
  assert.equal(sends[0].content, `Implement the following plan:\n\n${PLAN}`);
  const options = sends[0].options as Record<string, unknown>;
  assert.equal(options.permissionMode, 'default');
  assert.equal(options.model, 'test-model');
  assert.equal(options.sessionSummary, 'Add a hello file');

  // The view switches to it: it is registered and navigated to, opens in the
  // same mode instead of the provider-wide 'plan', and shows the plan message.
  assert.deepEqual(established.map((entry) => entry.sessionId), ['built-session']);
  assert.equal(established[0].context.project, PROJECT);
  assert.deepEqual(pinnedModes, [{ sessionId: 'built-session', mode: 'default' }]);
  assert.deepEqual(processing, ['built-session']);
  assert.equal(added.length, 1);
  assert.equal(added[0].targetSessionId, 'built-session');
  assert.equal(added[0].message.type, 'user');
  assert.equal(added[0].message.content, `Implement the following plan:\n\n${PLAN}`);

  // The permission answer goes out before the new session's first send.
  assert.ok(sent.indexOf(responses[0]) < sent.indexOf(sends[0]));
});

test('a failed session allocation leaves the plan approval pending', async () => {
  createSessionResponse = () => jsonResponse({ success: false }, 500);
  const { view, sent, added, established, pending } = renderComposer();

  await act(async () => { await view.result.current.handleBuildPlanInNewSession(PLAN_REQUEST); });

  assert.equal(sent.length, 0, 'neither answered nor sent: the plan card stays actionable');
  assert.deepEqual(pending.current, [PLAN_REQUEST], 'the approval is back on the plan card');
  assert.equal(established.length, 0);
  assert.equal(added.length, 1);
  assert.equal(added[0].message.type, 'error');
  assert.equal(added[0].targetSessionId, undefined, 'the error shows in the planning session');

  // Handed back for real: Build in this session now answers it.
  act(() => { view.result.current.handlePermissionDecision(PLAN_REQUEST.requestId, { allow: true }); });
  assert.deepEqual(sent.map((message) => [message.type, message.allow]), [['chat.permission-response', true]]);
});

test('Build, Revise or ⌘↩ while the new session is allocated does not build the plan in the planning session too', async () => {
  const allocation = holdSessionAllocation();
  const { view, sent, pending } = renderComposer();

  let handoff: Promise<void> = Promise.resolve();
  act(() => { handoff = view.result.current.handleBuildPlanInNewSession(PLAN_REQUEST); });

  // Claimed at once: the card's Build/Revise and ⌘↩ read the pending list.
  assert.deepEqual(pending.current, []);
  // Anything that still reaches the approval (a click that was already on its
  // way, a replayed prompt) is not answered in the planning session.
  act(() => {
    view.result.current.handlePermissionDecision(PLAN_REQUEST.requestId, { allow: true });
    view.result.current.handlePermissionDecision(PLAN_REQUEST.requestId, { allow: false, message: 'revise' });
  });
  assert.equal(sent.length, 0);

  await act(async () => { allocation.succeed(); await handoff; });

  assert.deepEqual(
    sent.map((message) => [message.type, message.allow ?? message.sessionId]),
    [['chat.permission-response', false], ['chat.send', 'built-session']],
    'one answer (the stop) and one build, in the new session only',
  );
});

test('a failed allocation after the user moved to another session does not put the approval in that session', async () => {
  const allocation = holdSessionAllocation();
  const { view, sent, pending } = renderComposer();

  let handoff: Promise<void> = Promise.resolve();
  act(() => { handoff = view.result.current.handleBuildPlanInNewSession(PLAN_REQUEST); });
  view.rerender({ openSession: { id: 'other-session', summary: 'Something else' } });
  pending.current = [];

  await act(async () => { allocation.fail(); await handoff; });

  assert.deepEqual(pending.current, []);
  assert.equal(sent.length, 0);
});

test('a second press while the first is in flight does not start a second session', async () => {
  const { view, sent } = renderComposer();

  await act(async () => {
    await Promise.all([
      view.result.current.handleBuildPlanInNewSession(PLAN_REQUEST),
      view.result.current.handleBuildPlanInNewSession(PLAN_REQUEST),
    ]);
  });

  assert.equal(createSessionCalls.length, 1);
  assert.equal(sent.filter((message) => message.type === 'chat.send').length, 1);
});

test('a plan approval without plan text is not moved', async () => {
  const { view, sent, added } = renderComposer();

  await act(async () => {
    await view.result.current.handleBuildPlanInNewSession({ ...PLAN_REQUEST, input: {} });
  });

  assert.equal(createSessionCalls.length, 0);
  assert.equal(sent.length, 0);
  assert.equal(added[0]?.message.type, 'error');
});

// ---------------------------------------------------------------------------
// The plan card's split Build button
// ---------------------------------------------------------------------------

const renderPlanCard = (buildPlan: (request: PendingPermissionRequest, inNewSession: boolean) => void) => render(
  <UiPreferencesProvider>
    <PermissionContext.Provider
      value={{
        pendingPermissionRequests: [PLAN_REQUEST],
        handlePermissionDecision: () => undefined,
        buildPlan,
      }}
    >
      <PlanDisplay title="Implementation plan" content={PLAN} defaultOpen toolName="ExitPlanMode" />
    </PermissionContext.Provider>
  </UiPreferencesProvider>,
);

test('by default Build builds in the same session and its menu offers a new session', () => {
  const buildPlan = vi.fn();
  renderPlanCard(buildPlan);

  fireEvent.click(screen.getByRole('button', { name: /^Build/ }));
  assert.deepEqual(buildPlan.mock.calls, [[PLAN_REQUEST, false]]);

  fireEvent.click(screen.getByRole('button', { name: 'More build options' }));
  fireEvent.click(screen.getByRole('menuitem', { name: /Build in new session/ }));
  assert.deepEqual(buildPlan.mock.calls[1], [PLAN_REQUEST, true]);
});

test('with "Build approved plans in: New session" the main button builds in a new session', () => {
  writeUserPreference('uiPreferences', { buildPlansInNewSession: true });
  const buildPlan = vi.fn();
  renderPlanCard(buildPlan);

  fireEvent.click(screen.getByRole('button', { name: /^Build in new session/ }));
  assert.deepEqual(buildPlan.mock.calls, [[PLAN_REQUEST, true]]);

  fireEvent.click(screen.getByRole('button', { name: 'More build options' }));
  fireEvent.click(screen.getByRole('menuitem', { name: /Build in this session/ }));
  assert.deepEqual(buildPlan.mock.calls[1], [PLAN_REQUEST, false]);
});

test('a plan card still renders where there is no live chat, as in the HTML export', () => {
  // The export renders transcripts through renderToStaticMarkup with neither
  // the permission context nor the UI preferences provider.
  const markup = renderToStaticMarkup(
    <PlanDisplay title="Implementation plan" content={PLAN} defaultOpen toolName="ExitPlanMode" />,
  );
  assert.match(markup, /Add a hello file/);
  assert.doesNotMatch(markup, /More build options/);
});

// ---------------------------------------------------------------------------
// ⌘↩ follows the setting
// ---------------------------------------------------------------------------

const pressBuildShortcut = (target: EventTarget = document.body, init: KeyboardEventInit = {}) => {
  target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', metaKey: true, bubbles: true, cancelable: true, ...init }));
};

test('⌘↩ builds the pending plan where the setting says', () => {
  const onBuildPlan = vi.fn();
  const { rerender } = renderHook(
    ({ buildInNewSession }) => usePlanBuildShortcut({
      isActive: true,
      pendingPlanRequest: PLAN_REQUEST,
      buildInNewSession,
      onBuildPlan,
    }),
    { initialProps: { buildInNewSession: false } },
  );

  pressBuildShortcut();
  pressBuildShortcut(document.body, { metaKey: false, ctrlKey: true });
  rerender({ buildInNewSession: true });
  pressBuildShortcut();

  assert.deepEqual(onBuildPlan.mock.calls, [
    [PLAN_REQUEST, false],
    [PLAN_REQUEST, false],
    [PLAN_REQUEST, true],
  ]);
});

test('⌘↩ leaves typed text to the composer and does nothing without a pending plan', () => {
  const onBuildPlan = vi.fn();
  const textarea = document.createElement('textarea');
  document.body.appendChild(textarea);

  const { rerender } = renderHook(
    ({ pendingPlanRequest, isActive }) => usePlanBuildShortcut({
      isActive,
      pendingPlanRequest,
      buildInNewSession: false,
      onBuildPlan,
    }),
    { initialProps: { pendingPlanRequest: PLAN_REQUEST as PendingPermissionRequest | null, isActive: true } },
  );

  textarea.value = 'a queued follow-up';
  pressBuildShortcut(textarea);
  assert.equal(onBuildPlan.mock.calls.length, 0, 'the composer sends its text instead');

  textarea.value = '';
  pressBuildShortcut(textarea);
  assert.equal(onBuildPlan.mock.calls.length, 1, 'an empty composer lets the shortcut build');

  pressBuildShortcut(document.body, { shiftKey: true });
  pressBuildShortcut(document.body, { metaKey: false });
  assert.equal(onBuildPlan.mock.calls.length, 1, 'only ⌘↩ / Ctrl+↩');

  rerender({ pendingPlanRequest: PLAN_REQUEST, isActive: false });
  pressBuildShortcut();
  rerender({ pendingPlanRequest: null, isActive: true });
  pressBuildShortcut();
  assert.equal(onBuildPlan.mock.calls.length, 1, 'a hidden chat or no pending plan ignores it');

  textarea.remove();
});
