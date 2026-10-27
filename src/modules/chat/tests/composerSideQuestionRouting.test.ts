import assert from 'node:assert/strict';

import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, test, vi } from 'vitest';

import '@/modules/i18n';
import { useChatComposerState } from '@/modules/chat/hooks/useChatComposerState';
import { clearQueuedMessage } from '@/shared/chatDrafts';
import type * as ChatDrafts from '@/shared/chatDrafts';
import type { PermissionMode, Project, ProjectSession, SessionActivityMap } from '@/shared/types';

/**
 * The send menu's choices and `/btw` route through the composer state:
 *
 * - Side question asks it on the side — one `chat.side_question` frame through the
 *   composer's own `sendMessage`, on the composer's current model so the fork
 *   stays on the session's prompt cache. It never sends `chat.send` and never
 *   queues, so the session itself never sees the question.
 * - Queue and Send anyway are the background-work answers given in advance,
 *   so the dialog that would ask them does not open.
 * - `/btw <question>` goes to the side question in every state that has a
 *   session, before the in-flight queue would take it.
 *
 * The menu's entry point is the hook member the Contract names,
 * `handleSendMenuChoice(choice: 'queue' | 'sideQuestion' | 'send'): Promise<void>`.
 *
 * Side questions are gated on the provider's capability: the hook takes
 * `supportsSideQuestions`, false until the capability matrix has loaded. Every
 * test that expects a frame passes true; the gate tests at the end pass false.
 */

const { appendQueuedMessage } = vi.hoisted(() => ({ appendQueuedMessage: vi.fn() }));

vi.mock('@/shared/chatDrafts', async (importOriginal) => {
  const actual = await importOriginal<typeof ChatDrafts>();
  return {
    ...actual,
    appendQueuedMessage: (...args: Parameters<typeof actual.appendQueuedMessage>) => {
      appendQueuedMessage(...args);
      return actual.appendQueuedMessage(...args);
    },
  };
});

const PROJECT: Project = { projectId: 'project-1', displayName: 'Project One', fullPath: '/tmp/project-one' };
const SESSION: ProjectSession = { id: 'session-1' };

const backgroundOnly: SessionActivityMap = new Map([[
  'session-1',
  {
    statusText: null,
    canInterrupt: false,
    startedAt: 1,
    background: true,
    tasks: [
      { taskId: 'a1', toolUseId: 'toolu_agent', taskType: 'local_agent', description: 'Survey the repo', startedAt: 1 },
    ],
  },
]]);

const responding: SessionActivityMap = new Map([[
  'session-1',
  { statusText: 'Writing', canInterrupt: true, startedAt: 1 },
]]);

type Frame = { type: string; sessionId?: string; sideQuestionId?: string; question?: string; options?: { model?: string } };
type SendMenuChoice = 'queue' | 'sideQuestion' | 'send';
type ComposerState = ReturnType<typeof useChatComposerState> & {
  handleSendMenuChoice: (choice: SendMenuChoice) => void | Promise<void>;
};

type AddedRow = { type?: string; content?: unknown };

const render = ({ isLoading, processingSessions, supportsSideQuestions = true }: {
  isLoading: boolean;
  processingSessions: SessionActivityMap;
  supportsSideQuestions?: boolean;
}) => {
  const sent: Frame[] = [];
  const added: AddedRow[] = [];
  // Every prompt the hook ever exposed, so a dialog that opened and closed
  // again between two assertions is still caught.
  const promptsSeen: unknown[] = [];
  const view = renderHook(() => {
    const state = useChatComposerState({
      selectedProject: PROJECT,
      selectedSession: SESSION,
      currentSessionId: SESSION.id,
      provider: 'claude',
      permissionMode: 'default',
      cyclePermissionMode: () => undefined,
      resolvePermissionModeForProvider: () => 'default' as PermissionMode,
      currentProviderModel: 'test-model',
      currentProviderEffort: 'medium',
      isLoading,
      processingSessions,
      canAbortSession: isLoading,
      tokenBudget: null,
      supportsSideQuestions,
      sendMessage: (message) => { sent.push(message as Frame); },
      scrollToBottom: () => undefined,
      addMessage: (message) => { added.push(message as AddedRow); },
      setIsUserScrolledUp: () => undefined,
      setPendingPermissionRequests: () => undefined,
    });
    if (state.backgroundSendPrompt) promptsSeen.push(state.backgroundSendPrompt);
    return state as ComposerState;
  });
  const of = (type: string) => sent.filter((message) => message.type === type);
  const types = () => sent.map((message) => message.type);
  return { view, of, types, promptsSeen, added };
};

type View = ReturnType<typeof render>['view'];

const choose = async (view: View, choice: SendMenuChoice) => {
  await act(async () => {
    await view.result.current.handleSendMenuChoice(choice);
  });
};

const submit = async (view: View) => {
  let pending!: Promise<void>;
  act(() => {
    pending = view.result.current.handleSubmit({ preventDefault: () => undefined } as never);
  });
  await act(async () => {
    await Promise.race([pending, new Promise((resolve) => setTimeout(resolve, 200))]);
  });
  // A background-work dialog holds the submit until it is answered. Answer it,
  // so a submit that wrongly asked fails on the assertions, not on a timeout.
  if (view.result.current.backgroundSendPrompt) {
    act(() => { view.result.current.resolveBackgroundSendPrompt('cancel'); });
  }
  await act(async () => { await pending; });
};

const assertOneSideQuestion = (frames: Frame[], question: string) => {
  assert.equal(frames.length, 1, 'exactly one chat.side_question frame');
  const [frame] = frames;
  assert.equal(frame?.sessionId, 'session-1');
  assert.equal(frame?.question, question);
  assert.match(frame?.sideQuestionId ?? '', /^[A-Za-z0-9_-]{1,100}$/, 'the client names the side question');
  assert.equal(frame?.options?.model, 'test-model', 'on the composer\'s current model');
};

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    if (String(url).includes('/api/user/drafts/queued-message') && init?.method === 'POST') {
      const { queuedMessage } = JSON.parse(String(init.body)) as { queuedMessage: unknown };
      return new Response(JSON.stringify({ success: true, queuedMessage, appended: false }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } });
  }));
  clearQueuedMessage(SESSION.id);
  appendQueuedMessage.mockReset();
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

for (const [name, state] of [
  ['while a turn is written', { isLoading: true, processingSessions: responding }],
  ['while only background work runs', { isLoading: false, processingSessions: backgroundOnly }],
] as const) {
  test(`Side question from the send menu ${name} sends one chat.side_question on the current model, and nothing else`, async () => {
    const { view, of, types, promptsSeen } = render(state);
    await act(async () => { view.result.current.setInput('what does this flag do?'); });

    await choose(view, 'sideQuestion');

    assertOneSideQuestion(of('chat.side_question'), 'what does this flag do?');
    assert.deepEqual(types(), ['chat.side_question'], 'the session never sees the question: no send, abort or stop');
    assert.equal(appendQueuedMessage.mock.calls.length, 0, 'and nothing is queued');
    assert.equal(view.result.current.queuedDraft, null);
    assert.equal(promptsSeen.length, 0, 'no background-work dialog');
    assert.equal(view.result.current.input, '', 'the composer is cleared');
  });
}

test('Side question in the background-work dialog sends one chat.side_question on the current model, and nothing else', async () => {
  const { view, of, types } = render({ isLoading: false, processingSessions: backgroundOnly });
  await act(async () => { view.result.current.setInput('hello'); });

  let pending!: Promise<void>;
  act(() => {
    pending = view.result.current.handleSubmit({ preventDefault: () => undefined } as never);
  });
  await waitFor(() => assert.ok(view.result.current.backgroundSendPrompt !== null, 'the dialog asks'));
  await act(async () => {
    view.result.current.resolveBackgroundSendPrompt('sideQuestion' as never);
    await pending;
  });

  assertOneSideQuestion(of('chat.side_question'), 'hello');
  assert.deepEqual(types(), ['chat.side_question'], 'no chat.send, abort or stop');
  assert.equal(appendQueuedMessage.mock.calls.length, 0, 'nothing is queued');
  assert.equal(view.result.current.queuedDraft, null);
  assert.equal(view.result.current.input, '', 'the composer is cleared');
});

test('Queue from the send menu over background work queues without opening the dialog', async () => {
  const { view, of, promptsSeen } = render({ isLoading: false, processingSessions: backgroundOnly });
  await act(async () => { view.result.current.setInput('hello'); });

  await choose(view, 'queue');

  assert.equal(promptsSeen.length, 0, 'the choice was already made in the menu');
  assert.equal(appendQueuedMessage.mock.calls.length, 1);
  assert.equal(appendQueuedMessage.mock.calls[0]?.[0], 'session-1');
  assert.equal(of('chat.send').length, 0);
  assert.equal(of('chat.side_question').length, 0);
  assert.equal(view.result.current.input, '');
});

test('Queue from the send menu while a turn is written queues the message', async () => {
  const { view, of, promptsSeen } = render({ isLoading: true, processingSessions: responding });
  await act(async () => { view.result.current.setInput('hello'); });

  await choose(view, 'queue');

  assert.equal(promptsSeen.length, 0);
  assert.equal(appendQueuedMessage.mock.calls.length, 1);
  assert.equal(of('chat.send').length, 0);
  assert.equal(of('chat.side_question').length, 0);
});

test('Send anyway from the send menu sends without opening the dialog', async () => {
  const { view, of, promptsSeen } = render({ isLoading: false, processingSessions: backgroundOnly });
  await act(async () => { view.result.current.setInput('hello'); });

  await choose(view, 'send');

  assert.equal(promptsSeen.length, 0, 'the choice was already made in the menu');
  assert.equal(of('chat.send').length, 1);
  assert.equal(of('chat.side_question').length, 0);
  assert.equal(appendQueuedMessage.mock.calls.length, 0);
});

for (const [name, state] of [
  ['while a turn is written', { isLoading: true, processingSessions: responding }],
  ['while only background work runs', { isLoading: false, processingSessions: backgroundOnly }],
  ['while idle, in a session', { isLoading: false, processingSessions: new Map() as SessionActivityMap }],
] as const) {
  test(`/btw <question> ${name} goes to the side question`, async () => {
    const { view, of, types, promptsSeen } = render(state);
    await act(async () => { view.result.current.setInput('/btw why is this test slow?'); });

    await submit(view);

    assertOneSideQuestion(of('chat.side_question'), 'why is this test slow?');
    assert.deepEqual(types(), ['chat.side_question'], 'not sent as a turn, and nothing stopped');
    assert.equal(appendQueuedMessage.mock.calls.length, 0, 'not queued');
    assert.equal(view.result.current.queuedDraft, null);
    assert.equal(promptsSeen.length, 0, 'no background-work dialog');
    assert.equal(view.result.current.input, '');
  });
}

// The capability gate. A provider that cannot answer side questions (Cursor,
// or any provider before the capability matrix has loaded) still recognises
// `/btw`, so the question is never sent as a turn by mistake; it refuses it
// with an error row instead and leaves the typed text for the user to reuse.
const UNSUPPORTED = 'This provider cannot answer side questions.';

for (const [name, state] of [
  ['while a turn is written', { isLoading: true, processingSessions: responding }],
  ['while only background work runs', { isLoading: false, processingSessions: backgroundOnly }],
  ['while idle, in a session', { isLoading: false, processingSessions: new Map() as SessionActivityMap }],
] as const) {
  test(`/btw <question> ${name} without side-question support sends nothing, keeps the input and says why`, async () => {
    const { view, types, promptsSeen, added } = render({ ...state, supportsSideQuestions: false });
    await act(async () => { view.result.current.setInput('/btw why is this test slow?'); });

    await submit(view);

    assert.deepEqual(types(), [], 'no side-question frame, no turn, nothing stopped');
    assert.equal(appendQueuedMessage.mock.calls.length, 0, 'not queued');
    assert.equal(view.result.current.queuedDraft, null);
    assert.equal(promptsSeen.length, 0, 'no background-work dialog');
    assert.equal(view.result.current.input, '/btw why is this test slow?', 'the typed text stays');
    const errors = added.filter((row) => row.type === 'error');
    assert.equal(errors.length, 1, 'one error row');
    assert.equal(errors[0]?.content, UNSUPPORTED);
  });
}

test('/btw is refused when the supportsSideQuestions option is left out, since the default is false', async () => {
  const sent: Frame[] = [];
  const added: AddedRow[] = [];
  const view = renderHook(() => useChatComposerState({
    selectedProject: PROJECT,
    selectedSession: SESSION,
    currentSessionId: SESSION.id,
    provider: 'claude',
    permissionMode: 'default',
    cyclePermissionMode: () => undefined,
    resolvePermissionModeForProvider: () => 'default' as PermissionMode,
    currentProviderModel: 'test-model',
    currentProviderEffort: 'medium',
    isLoading: false,
    processingSessions: new Map() as SessionActivityMap,
    canAbortSession: false,
    tokenBudget: null,
    sendMessage: (message) => { sent.push(message as Frame); },
    scrollToBottom: () => undefined,
    addMessage: (message) => { added.push(message as AddedRow); },
    setIsUserScrolledUp: () => undefined,
    setPendingPermissionRequests: () => undefined,
  }) as ComposerState);
  await act(async () => { view.result.current.setInput('/btw why is this test slow?'); });

  await submit(view);

  assert.deepEqual(sent.map((message) => message.type), []);
  assert.equal(view.result.current.input, '/btw why is this test slow?');
  assert.deepEqual(added.filter((row) => row.type === 'error').map((row) => row.content), [UNSUPPORTED]);
});
