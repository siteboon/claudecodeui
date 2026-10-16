import assert from 'node:assert/strict';

import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, test, vi } from 'vitest';

import '@/modules/i18n';
import { useQueuedMessages } from '@/modules/chat/hooks/useQueuedMessages';
import { useChatComposerState } from '@/modules/chat/hooks/useChatComposerState';
import { resetChatDrafts } from '@/shared/chatDrafts';
import type { QueuedMessage, ServerEvent } from '@/shared/types';

const apiMock = vi.hoisted(() => ({
  list: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  cancel: vi.fn(),
  operation: vi.fn(),
}));
vi.mock('@/shared/api', () => ({
  api: {
    queuedMessages: apiMock,
    user: {
      saveDraft: vi.fn(async () => ({ ok: true })),
      deleteDraft: vi.fn(async () => ({ ok: true })),
    },
    providers: {
      skills: vi.fn(async () => ({
        ok: true,
        json: async () => ({ data: [] }),
      })),
    },
    commands: {
      list: vi.fn(async () => ({
        ok: true,
        json: async () => ({ commands: [] }),
      })),
    },
    getFiles: vi.fn(async () => ({ ok: true, json: async () => [] })),
  },
}));
const ok = (data: unknown) =>
  ({ ok: true, json: async () => ({ data }) }) as Response;
const item = (id: string, sessionId = 'session'): QueuedMessage => ({
  id,
  sessionId,
  sequence: 1,
  content: id,
  attachments: [],
  options: {},
  revision: 1,
  status: 'queued',
  error: null,
});
let listener: (event: ServerEvent) => void;
const subscribe = (next: (event: ServerEvent) => void) => {
  listener = next;
  return () => {};
};
const send = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  resetChatDrafts();
  apiMock.list.mockResolvedValue(ok([item('B'), item('C')]));
  apiMock.create.mockImplementation(async (input) =>
    ok({ ...item(input.id), ...input }),
  );
  apiMock.update.mockImplementation(async (id, input) =>
    ok({ ...item(id), ...input, revision: input.revision + 1 }),
  );
  apiMock.cancel.mockResolvedValue(ok({ cancelled: true }));
  apiMock.operation.mockResolvedValue(ok(null));
});
afterEach(cleanup);

test('queue state survives rejection and duplicate steer clicks send one correlated request', async () => {
  const view = renderHook(() => useQueuedMessages('session', subscribe, send));
  await waitFor(() => assert.equal(view.result.current.queueItems.length, 2));
  act(() =>
    listener({
      kind: 'chat_subscribed',
      sessionId: 'session',
      activeTurnToken: 'turn-A',
    }),
  );
  act(() => {
    view.result.current.steer(item('B'));
    view.result.current.steer(item('B'));
  });
  assert.equal(send.mock.calls.length, 1);
  const request = send.mock.calls[0][0];
  assert.equal(request.activeTurnToken, 'turn-A');
  act(() =>
    listener({
      kind: 'chat_steer_result',
      ...request,
      status: 'rejected',
      error: 'turn changed',
    }),
  );
  await waitFor(() => assert.equal(view.result.current.pendingIds.size, 0));
  assert.deepEqual(
    view.result.current.queueItems.map((message) => message.id),
    ['B', 'C'],
  );
  assert.equal(view.result.current.canSteer, true);
  assert.equal(view.result.current.queueError, 'turn changed');
});

test('a delayed old-session result cannot clear the new session queue', async () => {
  const view = renderHook(
    ({ session }) => useQueuedMessages(session, subscribe, send),
    { initialProps: { session: 'session' } },
  );
  await waitFor(() => assert.equal(view.result.current.queueItems.length, 2));
  act(() =>
    listener({
      kind: 'status',
      text: 'active_turn',
      sessionId: 'session',
      activeTurnToken: 'turn-A',
    }),
  );
  act(() => view.result.current.steer(item('B')));
  const request = send.mock.calls[0][0];
  apiMock.list.mockResolvedValue(ok([item('other', 'other-session')]));
  view.rerender({ session: 'other-session' });
  await waitFor(() =>
    assert.equal(view.result.current.queueItems[0]?.id, 'other'),
  );
  act(() =>
    listener({ kind: 'chat_steer_result', ...request, status: 'accepted' }),
  );
  assert.equal(view.result.current.queueItems[0].id, 'other');
  assert.equal(view.result.current.canSteer, false);
});

test('manual enqueue retry after a lost response reuses its message id', async () => {
  apiMock.create.mockRejectedValueOnce(new Error('response lost'));
  const view = renderHook(() => useQueuedMessages('session', subscribe, send));
  await act(async () => {
    await assert.rejects(
      view.result.current.enqueue({
        content: 'new',
        options: {},
        attachments: [],
      }),
    );
  });
  await act(async () => {
    await view.result.current.enqueue({
      content: 'new',
      options: {},
      attachments: [],
    });
  });
  assert.equal(
    apiMock.create.mock.calls[0][0].id,
    apiMock.create.mock.calls[1][0].id,
  );
});

const PROJECT = {
  projectId: 'project',
  displayName: 'Project',
  fullPath: '/tmp/project',
};
const SESSION = { id: 'session' };
function composer(
  enqueue: (input: {
    content: string;
    attachments: unknown[];
    options: unknown;
  }) => Promise<QueuedMessage>,
  loading = true,
) {
  return renderHook(() =>
    useChatComposerState({
      selectedProject: PROJECT,
      selectedSession: SESSION,
      currentSessionId: 'session',
      provider: 'codex',
      permissionMode: 'default',
      cyclePermissionMode: () => {},
      resolvePermissionModeForProvider: () => 'default',
      currentProviderModel: 'model',
      currentProviderEffort: 'medium',
      isLoading: loading,
      hasQueuedMessages: true,
      canAbortSession: false,
      tokenBudget: null,
      sendMessage: send,
      scrollToBottom: () => {},
      addMessage: () => {},
      setIsUserScrolledUp: () => {},
      setPendingPermissionRequests: () => {},
      enqueueQueuedMessage: enqueue,
      updateQueuedMessage: async (message, input) => ({
        ...message,
        ...input,
        attachments: input.attachments as QueuedMessage['attachments'],
      }),
    }),
  );
}

test('consecutive Enter submissions append three messages instead of updating the previous one', async () => {
  const enqueue = vi.fn(async (input) => ({
    ...item(input.content),
    content: input.content,
  }));
  const view = composer(enqueue);
  for (const content of ['B', 'C', 'D']) {
    act(() => view.result.current.setInput(content));
    await act(async () => {
      await view.result.current.handleSubmit({ preventDefault() {} } as never);
    });
  }
  assert.deepEqual(
    enqueue.mock.calls.map(([input]) => input.content),
    ['B', 'C', 'D'],
  );
  assert.equal(send.mock.calls.length, 0);
});

test('an idle session with pending queue entries appends rather than bypassing FIFO', async () => {
  const enqueue = vi.fn(async (input) => ({
    ...item(input.content),
    content: input.content,
  }));
  const view = composer(enqueue, false);
  act(() => view.result.current.setInput('E'));
  await act(async () => {
    await view.result.current.handleSubmit({ preventDefault() {} } as never);
  });
  assert.equal(enqueue.mock.calls[0][0].content, 'E');
  assert.equal(send.mock.calls.length, 0);
});

test('failed persistence keeps input; a slow ACK cannot erase a newer draft', async () => {
  const enqueue = vi.fn().mockRejectedValueOnce(new Error('offline'));
  const view = composer(enqueue);
  act(() => view.result.current.setInput('keep me'));
  await act(async () => {
    await view.result.current.handleSubmit({ preventDefault() {} } as never);
  });
  assert.equal(view.result.current.input, 'keep me');
  let resolve!: (message: QueuedMessage) => void;
  enqueue.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  let submit!: Promise<void>;
  act(() => {
    submit = view.result.current.handleSubmit({ preventDefault() {} } as never);
  });
  await waitFor(() => assert.ok(resolve));
  act(() => view.result.current.setInput('new text'));
  await act(async () => {
    resolve(item('saved'));
    await submit;
  });
  assert.equal(view.result.current.input, 'new text');
});

test('editing a restored entry retains uploaded attachments and changes no other message', async () => {
  const view = composer(async () => {
    throw new Error('must update');
  });
  const message = {
    ...item('B'),
    attachments: [{ path: '/uploads/notes.pdf', name: 'notes.pdf' }],
  };
  act(() => view.result.current.editQueuedDraft(message));
  assert.equal(
    view.result.current.editingQueuedMessage?.attachments[0].path,
    '/uploads/notes.pdf',
  );
  act(() => view.result.current.setInput('edited B'));
  await act(async () => {
    await view.result.current.handleSubmit({ preventDefault() {} } as never);
  });
  assert.equal(view.result.current.editingQueuedMessage, null);
});
