import assert from 'node:assert/strict';

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, test, vi } from 'vitest';

import '@/modules/i18n';
import { useChatComposerState } from '@/modules/chat/hooks/useChatComposerState';
import type { PermissionMode, Project, ProjectSession } from '@/shared/types';

/**
 * A `/session/<id>` URL names a conversation. Between the navigation and the
 * moment that id resolves into `selectedSession` there is a window where the
 * composer has no session — and that window used to be read as "brand-new
 * chat": the first send allocated a *second* session and sent the message into
 * it, so the conversation on screen stayed untouched and one task ended up
 * split across two sessions.
 *
 * The route id is passed down for exactly this: while it is set and unresolved,
 * sending is refused and the text stays in the composer.
 */

const PROJECT: Project = { projectId: 'project-1', displayName: 'Project One', fullPath: '/tmp/project-one' };
const ROUTE_SESSION = 'route-session-1';

type PendingCreate = { resolve: (response: Response) => void };

let pendingCreates: PendingCreate[] = [];
let createdCount = 0;

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const createRequests = (fetchMock: ReturnType<typeof vi.fn>) => fetchMock.mock.calls
  .filter(([url, init]) => String(url) === '/api/providers/sessions' && (init as RequestInit | undefined)?.method === 'POST');

type RenderArgs = {
  session: ProjectSession | null;
  routeSessionId?: string | null;
  isLoading?: boolean;
  supportsSideQuestions?: boolean;
};

const renderComposer = (initial: RenderArgs) => {
  const sent: Array<{ type: string; sessionId?: string; content?: string; question?: string }> = [];
  const established: string[] = [];
  const messages: Array<{ type: string; content: unknown }> = [];
  const view = renderHook(({ session, routeSessionId, isLoading, supportsSideQuestions }: RenderArgs) =>
    useChatComposerState({
      selectedProject: PROJECT,
      selectedSession: session,
      currentSessionId: session?.id ?? null,
      routeSessionId,
      provider: 'claude',
      permissionMode: 'default',
      cyclePermissionMode: () => undefined,
      resolvePermissionModeForProvider: () => 'default' as PermissionMode,
      currentProviderModel: 'test-model',
      currentProviderEffort: 'medium',
      isLoading: isLoading ?? false,
      canAbortSession: false,
      tokenBudget: null,
      supportsSideQuestions: supportsSideQuestions ?? true,
      isConnected: true,
      sendMessage: (message) => { sent.push(message as { type: string }); },
      onSessionEstablished: (sessionId) => { established.push(sessionId); },
      scrollToBottom: () => undefined,
      addMessage: (message) => { messages.push(message as { type: string; content: unknown }); },
      setIsUserScrolledUp: () => undefined,
      setPendingPermissionRequests: () => undefined,
    }),
  { initialProps: initial });
  return {
    view,
    established,
    messages,
    sent,
    chatSends: () => sent.filter((message) => message.type === 'chat.send'),
    sideQuestions: () => sent.filter((message) => message.type === 'chat.side_question'),
  };
};

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  pendingCreates = [];
  createdCount = 0;
  fetchMock = vi.fn((url: RequestInfo | URL, init?: RequestInit) => {
    if (String(url) === '/api/providers/sessions' && init?.method === 'POST') {
      return new Promise<Response>((resolve) => { pendingCreates.push({ resolve }); });
    }
    return Promise.resolve(jsonResponse([]));
  });
  vi.stubGlobal('fetch', fetchMock);
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

test('sending while the route names an unresolved session allocates nothing and keeps the text', async () => {
  const { view, established, messages, chatSends } = renderComposer({
    session: null,
    routeSessionId: ROUTE_SESSION,
  });
  await act(async () => { view.result.current.setInput('hello'); });

  await act(async () => {
    void view.result.current.handleSubmit({ preventDefault: () => undefined } as never);
  });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });

  assert.equal(createRequests(fetchMock).length, 0, 'no second session may be created');
  assert.deepEqual(established, []);
  assert.equal(chatSends().length, 0);
  assert.equal(view.result.current.input, 'hello', 'the text stays for the retry');
  assert.ok(
    messages.some((message) => message.type === 'error'),
    'the refusal is explained instead of failing silently',
  );
});

test('sending is refused while the view still holds a different session than the route names', async () => {
  // The user navigated to another conversation and its details request has not
  // landed: the previous conversation is still the bound one. Sending here
  // delivered the message into that previous conversation, not the one the URL
  // names — a task filed into the wrong chat.
  const { view, messages, chatSends } = renderComposer({
    session: { id: 'previous-session' } as ProjectSession,
    routeSessionId: ROUTE_SESSION,
  });
  await act(async () => { view.result.current.setInput('hello'); });

  await act(async () => {
    void view.result.current.handleSubmit({ preventDefault: () => undefined } as never);
  });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });

  assert.equal(chatSends().length, 0, 'nothing may be delivered into the previous conversation');
  assert.equal(view.result.current.input, 'hello', 'the text stays for the retry');
  assert.ok(messages.some((message) => message.type === 'error'));
});

test('a running turn does not take a message meant for the routed conversation', async () => {
  // The view still holds the previous conversation while the route names the
  // next one. With a turn running, a send would be steered into (or queued for)
  // the previous conversation before any route check ran — the wrong-chat
  // outcome again, just through the queue/steer path.
  const { view, messages, sent } = renderComposer({
    session: { id: 'previous-session' } as ProjectSession,
    routeSessionId: ROUTE_SESSION,
    isLoading: true,
  });
  await act(async () => { view.result.current.setInput('hello'); });

  await act(async () => {
    void view.result.current.handleSubmit({ preventDefault: () => undefined } as never);
  });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });

  assert.deepEqual(sent, [], 'nothing is steered or queued into the previous conversation');
  assert.equal(view.result.current.input, 'hello');
  assert.ok(messages.some((message) => message.type === 'error'));
});

test('a chat whose route names the bound session still sends normally', async () => {
  const { view, chatSends } = renderComposer({
    session: { id: ROUTE_SESSION } as ProjectSession,
    routeSessionId: ROUTE_SESSION,
  });
  await act(async () => { view.result.current.setInput('hello'); });
  await act(async () => {
    void view.result.current.handleSubmit({ preventDefault: () => undefined } as never);
  });

  assert.deepEqual(
    chatSends().map((message) => [message.sessionId, message.content]),
    [[ROUTE_SESSION, 'hello']],
  );
});

test('a brand-new chat with no route session still allocates its session', async () => {
  const { view, established, chatSends } = renderComposer({ session: null, routeSessionId: null });
  await act(async () => { view.result.current.setInput('hello'); });

  await act(async () => {
    void view.result.current.handleSubmit({ preventDefault: () => undefined } as never);
  });
  await act(async () => {
    for (const pending of pendingCreates) {
      createdCount += 1;
      pending.resolve(jsonResponse({ success: true, data: { sessionId: 'session-1', sessionName: 'hello' } }, 201));
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  assert.equal(createRequests(fetchMock).length, 1);
  assert.deepEqual(established, ['session-1']);
  assert.deepEqual(chatSends().map((message) => [message.sessionId, message.content]), [['session-1', 'hello']]);
});

test('once the route session resolves, sending goes to that session', async () => {
  const { view, established, chatSends } = renderComposer({
    session: null,
    routeSessionId: ROUTE_SESSION,
  });
  await act(async () => { view.result.current.setInput('hello'); });
  await act(async () => {
    void view.result.current.handleSubmit({ preventDefault: () => undefined } as never);
  });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  assert.equal(chatSends().length, 0);

  // The details request lands: the route id is now bound to a session. The
  // composer swaps to that session's scope, and the refused text must be there
  // already — retyping it here would hide a refusal that ate the user's draft.
  await act(async () => {
    view.rerender({ session: { id: ROUTE_SESSION } as ProjectSession, routeSessionId: ROUTE_SESSION });
  });
  assert.equal(view.result.current.input, 'hello', 'the refused draft follows the session it was meant for');
  await act(async () => {
    void view.result.current.handleSubmit({ preventDefault: () => undefined } as never);
  });

  assert.equal(createRequests(fetchMock).length, 0, 'the existing session is used, never a new one');
  assert.deepEqual(established, []);
  assert.deepEqual(chatSends().map((message) => [message.sessionId, message.content]), [[ROUTE_SESSION, 'hello']]);
});

test('side-question submissions (/btw, send menu, Alt+Enter) refuse a mismatched or unresolved route without clearing text', async () => {
  const { view, messages, sideQuestions } = renderComposer({
    session: { id: 'previous-session' } as ProjectSession,
    routeSessionId: ROUTE_SESSION,
  });

  // 1. /btw command while bound session differs from the route.
  await act(async () => { view.result.current.setInput('/btw explain this'); });
  await act(async () => {
    await view.result.current.handleSubmit({ preventDefault: () => undefined } as never);
  });
  assert.equal(sideQuestions().length, 0, '/btw must not hit the previous session');
  assert.equal(view.result.current.input, '/btw explain this');

  // 2. Send menu side-question action.
  await act(async () => { view.result.current.setInput('explain via menu'); });
  await act(async () => {
    await view.result.current.handleSendMenuChoice('sideQuestion');
  });
  assert.equal(sideQuestions().length, 0, 'send menu sideQuestion must not hit the previous session');
  assert.equal(view.result.current.input, 'explain via menu');

  // 3. Option/Alt+Enter shortcut.
  await act(async () => {
    view.result.current.handleKeyDown({
      key: 'Enter',
      altKey: true,
      shiftKey: false,
      ctrlKey: false,
      metaKey: false,
      preventDefault: () => undefined,
      nativeEvent: { isComposing: false },
    } as unknown as Parameters<typeof view.result.current.handleKeyDown>[0]);
  });
  assert.equal(sideQuestions().length, 0, 'Alt+Enter must not hit the previous session');
  assert.equal(view.result.current.input, 'explain via menu');
  assert.equal(messages.filter((message) => message.type === 'error').length, 3);

  // Matching route sends the side question normally.
  await act(async () => {
    view.rerender({ session: { id: ROUTE_SESSION } as ProjectSession, routeSessionId: ROUTE_SESSION });
  });
  await act(async () => {
    view.result.current.setInput('/btw explain on target');
  });
  await act(async () => {
    await view.result.current.handleSubmit({ preventDefault: () => undefined } as never);
  });
  assert.deepEqual(
    sideQuestions().map((message) => [message.sessionId, message.question]),
    [[ROUTE_SESSION, 'explain on target']],
  );
  assert.equal(view.result.current.input, '');
});

test('a side question refused while the route session is unresolved stays parked until binding', async () => {
  const { view, sideQuestions } = renderComposer({
    session: null,
    routeSessionId: ROUTE_SESSION,
  });

  await act(async () => { view.result.current.setInput('what broke?'); });
  await act(async () => {
    await view.result.current.handleSendMenuChoice('sideQuestion');
  });
  assert.equal(sideQuestions().length, 0);

  await act(async () => {
    view.rerender({ session: { id: ROUTE_SESSION } as ProjectSession, routeSessionId: ROUTE_SESSION });
  });
  assert.equal(view.result.current.input, 'what broke?');

  await act(async () => {
    await view.result.current.handleSendMenuChoice('sideQuestion');
  });
  assert.deepEqual(
    sideQuestions().map((message) => [message.sessionId, message.question]),
    [[ROUTE_SESSION, 'what broke?']],
  );
});
