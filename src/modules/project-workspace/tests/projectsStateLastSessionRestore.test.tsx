import assert from 'node:assert/strict';

import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, test, vi } from 'vitest';

import type { Project, ProjectSession } from '@/shared/types';

/**
 * The root path reopens the conversation this browser had open last.
 *
 * Without it, "no session id in the URL" meant "new chat": reopening the tab
 * and sending a message allocated a second session, so one task ended up split
 * across two conversations. `/new` is the only state that starts a fresh chat.
 */

const projectsResponse = vi.fn();
const sessionDetailsResponse = vi.fn();

vi.mock('@/shared/api', () => ({
  api: {
    projects: () => projectsResponse(),
    projectTaskmaster: () => Promise.resolve({ ok: false }),
    sessionDetails: (sessionId: string) => sessionDetailsResponse(sessionId),
    projectSessions: () => Promise.resolve({ ok: false }),
  },
}));

const LAST_OPENED_SESSION_STORAGE_KEY = 'cloudcli:last-opened-session';

const buildProject = (): Project => ({
  projectId: 'project-1',
  path: '/repo',
  fullPath: '/repo',
  displayName: 'Repo',
  isStarred: false,
  sessions: [],
  sessionMeta: { hasMore: false, total: 0 },
});

type ServerEventListener = (event: { kind: string }) => void;

const listeners = new Set<ServerEventListener>();

const renderProjectsState = async (args: {
  sessionId?: string;
  isNewSessionRoute?: boolean;
}) => {
  const { useProjectsState } = await import('@/modules/project-workspace/hooks/useProjectsState');
  const navigate = vi.fn();
  let currentArgs = args;

  // The route arguments are hook props, so a rerender really is "the router
  // moved": the hook has to see the new value for its effects to re-run.
  const view = renderHook(
    (props: { sessionId?: string; isNewSessionRoute?: boolean }) =>
      useProjectsState({
        sessionId: props.sessionId,
        isNewSessionRoute: props.isNewSessionRoute,
        navigate,
        subscribe: (listener: ServerEventListener) => {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
        isMobile: false,
        isSessionProcessing: () => false,
      }),
    { initialProps: args },
  );

  /** Re-render as the router would after the user opens another route. */
  const reopen = (next: { sessionId?: string; isNewSessionRoute?: boolean }) => {
    currentArgs = { ...currentArgs, ...next };
    view.rerender(currentArgs);
  };

  return { view, navigate, reopen };
};

beforeEach(() => {
  localStorage.clear();
  projectsResponse.mockReset();
  projectsResponse.mockResolvedValue({
    ok: true,
    json: async () => [buildProject()],
  });
  sessionDetailsResponse.mockReset();
  // Echo the requested id back: a different one is the provider-alias case, which
  // navigates on its own and would be mistaken for a restore here.
  sessionDetailsResponse.mockImplementation(async (requestedSessionId: string) => ({
    ok: true,
    json: async () => ({ data: { sessionId: requestedSessionId, project: { projectId: 'project-1' } } }),
  }));
  listeners.clear();
});

afterEach(() => {
  vi.resetModules();
});

test('the root path reopens the conversation recorded in this browser', async () => {
  localStorage.setItem(
    LAST_OPENED_SESSION_STORAGE_KEY,
    JSON.stringify({ sessionId: 'session-1', projectId: 'project-1', updatedAt: Date.now() }),
  );

  const { view, navigate } = await renderProjectsState({});

  await waitFor(() => {
    assert.equal(navigate.mock.calls.length, 1);
  });

  assert.deepEqual(navigate.mock.calls[0], ['/session/session-1', { replace: true }]);
  assert.equal(view.result.current.isLoadingProjects, false);
  // The restore is a redirect, not a new chat: the sidebar must not be told to reset.
  assert.equal(view.result.current.newSessionTrigger, 0);
});

test('the explicit new-chat route keeps the blank composer instead of reopening', async () => {
  localStorage.setItem(
    LAST_OPENED_SESSION_STORAGE_KEY,
    JSON.stringify({ sessionId: 'session-1', projectId: 'project-1', updatedAt: Date.now() }),
  );

  const { view, navigate } = await renderProjectsState({ isNewSessionRoute: true });

  await waitFor(() => {
    assert.equal(view.result.current.isLoadingProjects, false);
  });

  assert.equal(navigate.mock.calls.length, 0);
});

test('a route that already names a session is never overridden', async () => {
  localStorage.setItem(
    LAST_OPENED_SESSION_STORAGE_KEY,
    JSON.stringify({ sessionId: 'session-1', projectId: 'project-1', updatedAt: Date.now() }),
  );

  const { view, navigate } = await renderProjectsState({ sessionId: 'session-2' });

  await waitFor(() => {
    assert.equal(view.result.current.isLoadingProjects, false);
  });

  assert.equal(navigate.mock.calls.length, 0, JSON.stringify(navigate.mock.calls));
});

test('a recorded conversation the backend no longer has is forgotten instead of opened', async () => {
  localStorage.setItem(
    LAST_OPENED_SESSION_STORAGE_KEY,
    JSON.stringify({ sessionId: 'session-1', projectId: 'project-1', updatedAt: Date.now() }),
  );
  sessionDetailsResponse.mockResolvedValue({ ok: false, status: 404 });

  const { view, navigate } = await renderProjectsState({});

  await waitFor(() => {
    assert.equal(view.result.current.isLoadingProjects, false);
  });

  await waitFor(() => {
    assert.equal(localStorage.getItem(LAST_OPENED_SESSION_STORAGE_KEY), null);
  });

  assert.equal(navigate.mock.calls.length, 0);
});

test('a temporary lookup failure keeps the record for the next load', async () => {
  localStorage.setItem(
    LAST_OPENED_SESSION_STORAGE_KEY,
    JSON.stringify({ sessionId: 'session-1', projectId: 'project-1', updatedAt: Date.now() }),
  );
  sessionDetailsResponse.mockResolvedValue({ ok: false, status: 503 });

  const { view, navigate } = await renderProjectsState({});

  await waitFor(() => {
    assert.equal(sessionDetailsResponse.mock.calls.length, 1);
  });
  await act(async () => { await Promise.resolve(); });

  assert.notEqual(localStorage.getItem(LAST_OPENED_SESSION_STORAGE_KEY), null);
  assert.equal(navigate.mock.calls.length, 0);
  assert.equal(view.result.current.isLoadingProjects, false);
});

test('opening another chat while the lookup is in flight wins over the restore', async () => {
  localStorage.setItem(
    LAST_OPENED_SESSION_STORAGE_KEY,
    JSON.stringify({ sessionId: 'session-1', projectId: 'project-1', updatedAt: Date.now() }),
  );
  let resolveDetails: (response: unknown) => void = () => undefined;
  const pendingLookup = new Promise((resolve) => { resolveDetails = resolve; });
  // Only the remembered session hangs; the chat the user opens must resolve
  // normally, otherwise its own alias check would navigate and muddy the result.
  sessionDetailsResponse.mockImplementation(async (requestedSessionId: string) => {
    if (requestedSessionId === 'session-1') {
      return pendingLookup;
    }
    return { ok: true, json: async () => ({ data: { sessionId: requestedSessionId, project: { projectId: 'project-1' } } }) };
  });

  const { view, navigate, reopen } = await renderProjectsState({});
  await waitFor(() => {
    assert.equal(sessionDetailsResponse.mock.calls.length, 1);
  });

  // 项目加载完后，详情查询仍在进行，主区域应继续等待。
  assert.equal(view.result.current.isLoadingProjects, false);
  assert.equal(view.result.current.isRestoringLastSession, true);

  // The user picks a conversation before the remembered one comes back.
  await act(async () => { reopen({ sessionId: 'session-2' }); });
  assert.equal(view.result.current.isRestoringLastSession, false);
  await act(async () => {
    resolveDetails({
      ok: true,
      json: async () => ({ data: { sessionId: 'session-1', project: { projectId: 'project-1' } } }),
    });
  });
  // The continuation sits behind a few awaits; drain them so the assertion below
  // sees whatever the lookup decided to do.
  await act(async () => {
    for (let tick = 0; tick < 10; tick += 1) {
      await Promise.resolve();
    }
  });

  assert.equal(
    navigate.mock.calls.some((call) => call[0] === '/session/session-1'),
    false,
    `a late lookup must not drag the user back: ${JSON.stringify(navigate.mock.calls)}`,
  );
  assert.notEqual(localStorage.getItem(LAST_OPENED_SESSION_STORAGE_KEY), null);
  assert.equal(view.result.current.isLoadingProjects, false);
});

test('entering /new after viewing a session clears the selection and resets chat state once', async () => {
  const { view, reopen } = await renderProjectsState({ isNewSessionRoute: true });

  await waitFor(() => {
    assert.equal(view.result.current.isLoadingProjects, false);
  });

  // Opening a conversation from /new binds selectedSession; navigating back to
  // /new reuses the mounted provider and must drop that session and reset chat.
  await act(async () => {
    reopen({ sessionId: 'session-1', isNewSessionRoute: false });
  });
  await waitFor(() => {
    assert.equal(view.result.current.selectedSession?.id, 'session-1');
  });
  const triggerBeforeBack = view.result.current.newSessionTrigger;

  await act(async () => {
    reopen({ sessionId: undefined, isNewSessionRoute: true });
  });
  assert.equal(view.result.current.selectedSession, null);
  assert.equal(view.result.current.activeTab, 'chat');
  assert.equal(view.result.current.newSessionTrigger, triggerBeforeBack + 1);

  // Staying on /new while first-message allocation binds an optimistic session
  // must keep that selection instead of clearing it continuously.
  await act(async () => {
    view.result.current.registerOptimisticSession({
      sessionId: 'allocated-session',
      provider: 'claude',
      project: buildProject(),
      summary: 'hello',
    });
  });
  assert.equal((view.result.current.selectedSession as ProjectSession | null)?.id, 'allocated-session');
});
test('keeps the restoring state while the routed session outside the first page is binding', async () => {
  localStorage.setItem(LAST_OPENED_SESSION_STORAGE_KEY, JSON.stringify({
    sessionId: 'remembered', projectId: 'project-1', updatedAt: Date.now(),
  }));
  let finishBinding: (response: unknown) => void = () => undefined;
  const pendingBinding = new Promise((resolve) => { finishBinding = resolve; });
  const details = {
    ok: true,
    json: async () => ({ data: { sessionId: 'remembered', project: { projectId: 'project-1' } } }),
  };
  sessionDetailsResponse.mockResolvedValueOnce(details).mockReturnValueOnce(pendingBinding);
  const { view, navigate, reopen } = await renderProjectsState({});

  await waitFor(() => assert.deepEqual(navigate.mock.calls[0], ['/session/remembered', { replace: true }]));
  reopen({ sessionId: 'remembered' });
  assert.equal(view.result.current.isRestoringLastSession, true);
  assert.equal(view.result.current.selectedSession, null);

  await act(async () => finishBinding(details));
  await waitFor(() => assert.equal(view.result.current.selectedSession?.id, 'remembered'));
  assert.equal(view.result.current.isRestoringLastSession, false);
});
