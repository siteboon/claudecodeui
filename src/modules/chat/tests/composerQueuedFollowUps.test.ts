import assert from 'node:assert/strict';

import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, test, vi } from 'vitest';

import { i18n } from '@/modules/i18n';
import { useChatComposerState } from '@/modules/chat/hooks/useChatComposerState';
import { readDraftText, resetChatDrafts, writeDraftText } from '@/shared/chatDrafts';
import type { BackgroundSendChoice, ChatMessage, PermissionMode, Project, ProjectSession, SessionActivityMap } from '@/shared/types';

/**
 * #1587: follow-ups submitted while a turn runs used to replace each other in
 * the session's single queued slot, so only the last one reached the
 * provider and nothing said the others were gone. Every accepted follow-up
 * must now be kept, in order, and the card must show all of them.
 *
 * The server is faked at the HTTP boundary with the drafts contract the real
 * server implements, so these tests see what would be stored in
 * `session_drafts.queued_message` (what the dispatcher sends), not only what
 * the card renders.
 */

type StoredQueued = { content: string; options?: Record<string, unknown>; attachments: unknown[] };
type StoredDraft = { text: string; queuedMessage: StoredQueued | null };

const PROJECT: Project = { projectId: 'project-1', displayName: 'Project One', fullPath: '/tmp/project-one' };
const SESSION_1: ProjectSession = { id: 'session-1' };
const SESSION_2: ProjectSession = { id: 'session-2' };

let server: Map<string, StoredDraft>;
let refuseQueueing = false;
// Held open by a test to keep an upload in flight (e.g. across a session switch).
let uploadGate: Promise<void> | null = null;
// Held open by a test to keep an append's response in flight. The server has
// already applied the append by then, as a real one would before answering.
let appendGate: Promise<void> | null = null;
// Held open by a test to keep a clear from reaching the store, as a request
// that took a slower connection would.
let clearGate: Promise<void> | null = null;
let appendRequestCount = 0;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json' },
});

const dropIfEmpty = (scope: string) => {
  const draft = server.get(scope);
  if (draft && !draft.text && !draft.queuedMessage) {
    server.delete(scope);
  }
};

// The drafts endpoints, as the server implements them.
const fakeServer = async (url: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const path = String(url);
  const method = init?.method ?? 'GET';
  const body = init?.body && typeof init.body === 'string' ? JSON.parse(init.body) as Record<string, unknown> : {};
  const scope = String(body.scope ?? '');

  if (path.includes('/api/assets/files')) {
    await uploadGate;
    const form = init?.body instanceof FormData ? init.body : new FormData();
    const files = form.getAll('files') as File[];
    return json({ attachments: files.map((file) => ({ name: file.name, path: `/uploads/${file.name}` })) });
  }

  if (path.endsWith('/api/user/drafts/queued-message')) {
    if (method === 'POST') {
      appendRequestCount += 1;
      if (refuseQueueing) {
        await appendGate;
        return json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } }, 500);
      }
      const message = body.queuedMessage as StoredQueued;
      const current = server.get(scope) ?? { text: '', queuedMessage: null };
      const waiting = current.queuedMessage;
      const isCommand = (queued: StoredQueued) => queued.content.trimStart().startsWith('/');
      if (waiting && (isCommand(waiting) || isCommand(message))) {
        await appendGate;
        return json({
          success: false,
          error: { code: 'QUEUED_MESSAGE_NOT_COMBINABLE', message: 'A slash command runs as a turn of its own' },
        }, 409);
      }
      const queuedMessage: StoredQueued = waiting
        ? {
            content: [waiting.content, message.content].filter((part) => part.trim()).join('\n\n'),
            options: message.options ?? waiting.options,
            attachments: [...waiting.attachments, ...(message.attachments ?? [])],
          }
        : { content: message.content, options: message.options, attachments: message.attachments ?? [] };
      server.set(scope, { ...current, queuedMessage });
      await appendGate;
      return json({ success: true, queuedMessage, appended: Boolean(waiting) });
    }
    if (method === 'DELETE') {
      await clearGate;
      const current = server.get(scope);
      if (current) {
        server.set(scope, { ...current, queuedMessage: null });
        dropIfEmpty(scope);
      }
      return json({ success: true });
    }
  }

  if (path.endsWith('/api/user/drafts')) {
    if (method === 'GET') {
      return json({ success: true, drafts: [...server].map(([draftScope, draft]) => ({ scope: draftScope, ...draft })) });
    }
    if (method === 'PUT') {
      const text = typeof body.text === 'string' ? body.text : '';
      const current = server.get(scope) ?? { text: '', queuedMessage: null };
      server.set(scope, body.queuedMessage === undefined
        ? { ...current, text }
        : { text, queuedMessage: (body.queuedMessage as StoredQueued | null) ?? null });
      dropIfEmpty(scope);
      return json({ success: true });
    }
    if (method === 'DELETE') {
      server.delete(scope);
      return json({ success: true });
    }
  }

  return json([]);
};

// What the server's dispatcher does when the session goes idle: take the
// queued message off the queue to send it.
const dispatcherClaims = (scope: string): StoredQueued | null => {
  const draft = server.get(scope);
  const claimed = draft?.queuedMessage ?? null;
  if (draft) {
    server.set(scope, { ...draft, queuedMessage: null });
    dropIfEmpty(scope);
  }
  return claimed;
};

type Props = {
  session: ProjectSession;
  isLoading: boolean;
  model: string;
  processingSessions?: SessionActivityMap;
};

const render = (initialProps: Partial<Props> = {}) => {
  const errors: ChatMessage[] = [];
  const view = renderHook(
    ({ session, isLoading, model, processingSessions }: Props) => useChatComposerState({
      selectedProject: PROJECT,
      selectedSession: session,
      currentSessionId: session.id ?? null,
      provider: 'claude',
      permissionMode: 'default',
      cyclePermissionMode: () => undefined,
      resolvePermissionModeForProvider: () => 'default' as PermissionMode,
      currentProviderModel: model,
      currentProviderEffort: 'medium',
      isLoading,
      processingSessions,
      canAbortSession: false,
      tokenBudget: null,
      sendMessage: () => undefined,
      scrollToBottom: () => undefined,
      addMessage: (message) => {
        if (message.type === 'error') errors.push(message);
      },
      setIsUserScrolledUp: () => undefined,
      setPendingPermissionRequests: () => undefined,
    }),
    { initialProps: { session: SESSION_1, isLoading: true, model: 'model-1', ...initialProps } },
  );
  return { view, errors };
};

type View = ReturnType<typeof render>['view'];

const submit = async (view: View, text: string, files: File[] = []) => {
  await act(async () => {
    view.result.current.setInput(text);
    view.result.current.setAttachedFiles(files);
  });
  await act(async () => {
    await view.result.current.handleSubmit({ preventDefault: () => undefined } as never);
  });
};

const queuedOnServer = (scope = 'session-1') => server.get(scope)?.queuedMessage ?? null;

const hold = () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  return { gate, release };
};

// Presses Enter without waiting for the submit to finish.
const startSubmit = (view: View) => {
  let pending!: Promise<void>;
  act(() => {
    pending = view.result.current.handleSubmit({ preventDefault: () => undefined } as never);
  });
  return pending;
};

beforeEach(() => {
  server = new Map();
  refuseQueueing = false;
  uploadGate = null;
  appendGate = null;
  clearGate = null;
  appendRequestCount = 0;
  resetChatDrafts();
  localStorage.clear();
  vi.stubGlobal('fetch', vi.fn(fakeServer));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  resetChatDrafts();
  localStorage.clear();
});

test('follow-ups A, B and C queued during one turn are all kept, in order, and the card shows them all', async () => {
  const { view } = render();

  await submit(view, 'follow-up A');
  await submit(view, 'follow-up B', [new File(['b'], 'b.txt', { type: 'text/plain' })]);
  view.rerender({ session: SESSION_1, isLoading: true, model: 'model-2' });
  await submit(view, 'follow-up C');

  assert.equal(queuedOnServer()?.content, 'follow-up A\n\nfollow-up B\n\nfollow-up C', 'all three will be sent, in order');
  assert.deepEqual(queuedOnServer()?.attachments, [{ name: 'b.txt', path: '/uploads/b.txt' }]);
  assert.equal(queuedOnServer()?.options?.model, 'model-2', 'the latest send options win');
  assert.equal(view.result.current.queuedDraft?.content, 'follow-up A\n\nfollow-up B\n\nfollow-up C');
  assert.equal(view.result.current.queuedDraft?.uploadedAttachments?.length, 1);
  assert.equal(view.result.current.input, '');
});

test('a follow-up queued after the server sent the waiting one is queued alone, so nothing is sent twice', async () => {
  const { view } = render();
  await submit(view, 'follow-up A');

  // The turn ended and the dispatcher took A, before this page heard about it.
  assert.equal(dispatcherClaims('session-1')?.content, 'follow-up A');
  assert.equal(view.result.current.queuedDraft?.content, 'follow-up A', 'the card has not caught up yet');

  await submit(view, 'follow-up B');

  assert.deepEqual(queuedOnServer(), { content: 'follow-up B', options: queuedOnServer()?.options, attachments: [] });
  assert.equal(view.result.current.queuedDraft?.content, 'follow-up B', 'the card shows what will be sent');
});

test('typing after the server sent the queued message does not bring it back', async () => {
  const { view } = render();
  await submit(view, 'follow-up A');
  dispatcherClaims('session-1');

  // The user keeps writing the next follow-up; the text save is debounced.
  await act(async () => { view.result.current.setInput('still writing the next one'); });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 1_300)); });

  assert.equal(server.get('session-1')?.text, 'still writing the next one', 'the text was saved');
  assert.equal(queuedOnServer(), null, 'and A, already sent, is not queued again');
});

test('queueing behind background work adds to a message already waiting there', async () => {
  const background: SessionActivityMap = new Map([[
    'session-1',
    { statusText: null, canInterrupt: false, startedAt: 1, background: true, tasks: [] },
  ]]);
  const { view } = render({ isLoading: false, processingSessions: background });

  const queueBehindWork = async (text: string) => {
    await act(async () => { view.result.current.setInput(text); });
    let pending!: Promise<void>;
    act(() => {
      pending = view.result.current.handleSubmit({ preventDefault: () => undefined } as never);
    });
    await waitFor(() => assert.notEqual(view.result.current.backgroundSendPrompt, null));
    await act(async () => {
      view.result.current.resolveBackgroundSendPrompt('queue' as BackgroundSendChoice);
      await pending;
    });
  };

  await queueBehindWork('after the job: A');
  await queueBehindWork('after the job: B');

  assert.equal(queuedOnServer()?.content, 'after the job: A\n\nafter the job: B');
  assert.equal(view.result.current.queuedDraft?.content, 'after the job: A\n\nafter the job: B');
});

test('editing the merged card brings every follow-up back and takes it off the queue', async () => {
  const fileA = new File(['a'], 'a.txt', { type: 'text/plain' });
  const fileB = new File(['b'], 'b.txt', { type: 'text/plain' });
  const { view } = render();
  await submit(view, 'follow-up A', [fileA]);
  await submit(view, 'follow-up B', [fileB]);

  await act(async () => { view.result.current.editQueuedDraft(); });

  assert.equal(view.result.current.input, 'follow-up A\n\nfollow-up B');
  assert.deepEqual(view.result.current.attachedFiles.map((file) => file.name), ['a.txt', 'b.txt']);
  assert.equal(view.result.current.queuedDraft, null);
  await waitFor(() => assert.equal(queuedOnServer(), null, 'nothing is left for the dispatcher to send'));
});

test('deleting the merged card takes the whole message off the queue', async () => {
  const { view } = render();
  await submit(view, 'follow-up A');
  await submit(view, 'follow-up B');

  await act(async () => { view.result.current.deleteQueuedDraft(); });

  assert.equal(view.result.current.queuedDraft, null);
  await waitFor(() => assert.equal(queuedOnServer(), null));
});

test('a message queued from another tab is kept and shown when this tab queues one', async () => {
  // Another tab (or this page before a reload) queued A; this page has not heard of it.
  server.set('session-1', { text: '', queuedMessage: { content: 'from the other tab', attachments: [] } });
  const { view } = render();

  await submit(view, 'from this tab');

  assert.equal(queuedOnServer()?.content, 'from the other tab\n\nfrom this tab');
  assert.equal(view.result.current.queuedDraft?.content, 'from the other tab\n\nfrom this tab');
});

test('the card follows the server when another tab adds to the queued message', async () => {
  const { view } = render();
  await submit(view, 'follow-up A');
  server.set('session-1', { text: '', queuedMessage: { content: 'follow-up A\n\nfrom the other tab', attachments: [] } });

  // The card re-reads the server every 5 s while it is shown.
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 5_300)); });

  assert.equal(view.result.current.queuedDraft?.content, 'follow-up A\n\nfrom the other tab');
}, 10_000);

test('a follow-up the server does not accept stays in the composer, with an error, and no card', async () => {
  const { view, errors } = render();
  refuseQueueing = true;

  await submit(view, 'follow-up A');

  assert.equal(view.result.current.input, 'follow-up A', 'the message is kept for another try');
  assert.equal(view.result.current.queuedDraft, null, 'no card for a message nothing will send');
  assert.equal(errors.length, 1);
  assert.equal(errors[0]?.content, 'Failed to queue message: Internal server error', 'what the server said');
});

test('a slash command is not merged with a queued message: it stays in the composer, with an error', async () => {
  const { view, errors } = render();
  await submit(view, 'fix the failing test');

  await submit(view, '/compact');

  assert.equal(queuedOnServer()?.content, 'fix the failing test', 'the queued text is not turned into /compact arguments');
  assert.equal(view.result.current.queuedDraft?.content, 'fix the failing test');
  assert.equal(view.result.current.input, '/compact', 'the command is kept to send on its own later');
  assert.equal(errors.length, 1);
  assert.equal(errors[0]?.content, 'Failed to queue message: A slash command runs as a turn of its own, so it cannot be combined with the queued message. Send it after the queued message has gone.');
});

test('the slash-command refusal is shown in the user\'s language', async () => {
  await i18n.changeLanguage('de');
  try {
    const { view, errors } = render();
    await submit(view, 'fix the failing test');

    await submit(view, '/compact');

    assert.equal(errors.length, 1);
    assert.equal(errors[0]?.content, i18n.t('chat:input.queue.notCombinable'));
    assert.match(String(errors[0]?.content), /^Nachricht konnte nicht in die Warteschlange gestellt werden/);
  } finally {
    await i18n.changeLanguage('en');
  }
});

test('switching sessions during the upload still queues the follow-up behind the earlier one', async () => {
  const { view } = render();
  await submit(view, 'follow-up A');

  let releaseUpload!: () => void;
  uploadGate = new Promise((resolve) => { releaseUpload = resolve; });
  await act(async () => {
    view.result.current.setInput('follow-up B');
    view.result.current.setAttachedFiles([new File(['b'], 'b.txt', { type: 'text/plain' })]);
  });
  let pending!: Promise<void>;
  act(() => {
    pending = view.result.current.handleSubmit({ preventDefault: () => undefined } as never);
  });
  view.rerender({ session: SESSION_2, isLoading: true, model: 'model-1' });
  await act(async () => {
    releaseUpload();
    await pending;
  });

  assert.equal(queuedOnServer('session-1')?.content, 'follow-up A\n\nfollow-up B');
  assert.equal(view.result.current.queuedDraft, null, 'the session now open has no card of its own');
  assert.equal(readDraftText('session-1'), '', 'and going back will not offer B to be queued again');
});

test('what the user types while a follow-up is being queued stays in the composer', async () => {
  const { view } = render();
  const response = hold();
  appendGate = response.gate;

  await act(async () => { view.result.current.setInput('follow-up A'); });
  const pending = startSubmit(view);
  await waitFor(() => assert.equal(appendRequestCount, 1));
  assert.equal(view.result.current.input, '', 'the composer empties when the message is taken');

  // The next follow-up, typed before the server has answered.
  await act(async () => { view.result.current.setInput('the next one, typed meanwhile'); });
  await act(async () => {
    response.release();
    await pending;
  });

  assert.equal(view.result.current.input, 'the next one, typed meanwhile');
  assert.equal(readDraftText('session-1'), 'the next one, typed meanwhile');
  assert.equal(queuedOnServer()?.content, 'follow-up A');
  assert.equal(view.result.current.queuedDraft?.content, 'follow-up A');
});

test('a follow-up the server refuses goes back in front of what was typed meanwhile', async () => {
  const fileA = new File(['a'], 'a.txt', { type: 'text/plain' });
  const fileC = new File(['c'], 'c.txt', { type: 'text/plain' });
  const { view, errors } = render();
  refuseQueueing = true;
  const response = hold();
  appendGate = response.gate;

  await act(async () => {
    view.result.current.setInput('follow-up A');
    view.result.current.setAttachedFiles([fileA]);
  });
  const pending = startSubmit(view);
  await waitFor(() => assert.equal(appendRequestCount, 1));
  await act(async () => {
    view.result.current.setInput('more');
    view.result.current.setAttachedFiles([fileC]);
  });
  await act(async () => {
    response.release();
    await pending;
  });

  assert.equal(view.result.current.input, 'follow-up A\n\nmore');
  assert.deepEqual(view.result.current.attachedFiles.map((file) => file.name), ['a.txt', 'c.txt']);
  assert.equal(view.result.current.queuedDraft, null);
  assert.equal(errors.length, 1);
});

test('Enter pressed again while a follow-up is being queued neither sends it twice nor drops the next one', async () => {
  const { view } = render();
  const response = hold();
  appendGate = response.gate;

  await act(async () => { view.result.current.setInput('follow-up A'); });
  const first = startSubmit(view);
  await waitFor(() => assert.equal(appendRequestCount, 1));
  const again = startSubmit(view);
  await act(async () => { view.result.current.setInput('follow-up B'); });
  const next = startSubmit(view);
  await act(async () => {
    response.release();
    await Promise.all([first, again, next]);
  });

  const queued = queuedOnServer()?.content;
  const kept = view.result.current.input;
  assert.ok(
    (queued === 'follow-up A' && kept === 'follow-up B')
      || (queued === 'follow-up A\n\nfollow-up B' && kept === ''),
    `A is queued once and B is either queued after it or still in the composer (queued ${JSON.stringify(queued)}, composer ${JSON.stringify(kept)})`,
  );
});

test('Enter pressed while a refused follow-up is still being answered keeps both, in the order they were typed', async () => {
  const { view, errors } = render();
  refuseQueueing = true;
  const response = hold();
  appendGate = response.gate;

  await act(async () => { view.result.current.setInput('follow-up A'); });
  const first = startSubmit(view);
  await waitFor(() => assert.equal(appendRequestCount, 1));
  await act(async () => { view.result.current.setInput('follow-up B'); });
  const next = startSubmit(view);
  await act(async () => {
    response.release();
    await Promise.all([first, next]);
  });

  assert.equal(view.result.current.input, 'follow-up A\n\nfollow-up B', 'B waits in the composer, behind A');
  assert.equal(appendRequestCount, 1, 'B is not sent while A is still being answered');
  assert.equal(errors.length, 1);
  assert.equal(queuedOnServer(), null);
});

test('Edit then Enter re-queues the merged message even when the clear reaches the server late', async () => {
  const { view } = render();
  await submit(view, 'follow-up A');
  await submit(view, 'follow-up B');

  const clear = hold();
  clearGate = clear.gate;
  await act(async () => { view.result.current.editQueuedDraft(); });
  assert.equal(view.result.current.input, 'follow-up A\n\nfollow-up B');
  const pending = startSubmit(view);
  // Give the re-queue every chance to overtake the clear.
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)); });
  await act(async () => {
    clear.release();
    await pending;
  });

  assert.equal(queuedOnServer()?.content, 'follow-up A\n\nfollow-up B', 'queued once, and not cleared afterwards');
  assert.equal(view.result.current.queuedDraft?.content, 'follow-up A\n\nfollow-up B');
});

test('Edit used while a follow-up is being queued takes back only the message it showed', async () => {
  const { view } = render();
  await submit(view, 'follow-up A');

  const response = hold();
  appendGate = response.gate;
  await act(async () => { view.result.current.setInput('follow-up B'); });
  const pending = startSubmit(view);
  // The server has appended B, but this page has not heard back yet.
  await waitFor(() => assert.equal(queuedOnServer()?.content, 'follow-up A\n\nfollow-up B'));
  await act(async () => { view.result.current.editQueuedDraft(); });
  await act(async () => {
    response.release();
    await pending;
  });

  assert.equal(view.result.current.input, 'follow-up A', 'A is back in the composer to edit');
  await waitFor(() => assert.equal(queuedOnServer()?.content, 'follow-up B', 'and B is still queued'));
  assert.equal(view.result.current.queuedDraft?.content, 'follow-up B');
});

test('Edit after the card caught up with another tab still brings back this tab\'s files', async () => {
  const fileA = new File(['a'], 'a.txt', { type: 'text/plain' });
  const { view } = render();
  await submit(view, 'follow-up A', [fileA]);
  server.set('session-1', {
    text: '',
    queuedMessage: {
      content: 'follow-up A\n\nfrom the other tab',
      attachments: [{ name: 'a.txt', path: '/uploads/a.txt' }],
    },
  });

  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 5_300)); });
  assert.equal(view.result.current.queuedDraft?.content, 'follow-up A\n\nfrom the other tab');
  await act(async () => { view.result.current.editQueuedDraft(); });

  assert.equal(view.result.current.input, 'follow-up A\n\nfrom the other tab');
  assert.deepEqual(view.result.current.attachedFiles.map((file) => file.name), ['a.txt']);
}, 10_000);

test('Edit after another tab added a file to the queued message still brings back this tab\'s files', async () => {
  const fileA = new File(['a'], 'a.txt', { type: 'text/plain' });
  const { view } = render();
  await submit(view, 'follow-up A', [fileA]);
  server.set('session-1', {
    text: '',
    queuedMessage: {
      content: 'follow-up A\n\nfrom the other tab',
      attachments: [{ name: 'a.txt', path: '/uploads/a.txt' }, { name: 'x.txt', path: '/uploads/x.txt' }],
    },
  });

  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 5_300)); });
  assert.equal(view.result.current.queuedDraft?.uploadedAttachments?.length, 2, 'the card shows both files');
  await act(async () => { view.result.current.editQueuedDraft(); });

  // x.txt was uploaded by the other tab, so this page has no browser file for it.
  assert.deepEqual(view.result.current.attachedFiles.map((file) => file.name), ['a.txt']);
}, 10_000);

test('a tab that is shown again catches up with the queued message at once', async () => {
  const { view } = render();
  await submit(view, 'follow-up A');
  server.set('session-1', { text: '', queuedMessage: { content: 'follow-up A\n\nfrom the other tab', attachments: [] } });

  await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });

  await waitFor(
    () => assert.equal(view.result.current.queuedDraft?.content, 'follow-up A\n\nfrom the other tab'),
    { timeout: 1_000 },
  );
});

test('files of a message already sent do not come back with a follow-up queued after it', async () => {
  const fileA = new File(['a'], 'a.txt', { type: 'text/plain' });
  const fileB = new File(['b'], 'b.txt', { type: 'text/plain' });
  const { view } = render();
  await submit(view, 'follow-up A', [fileA]);
  // The dispatcher sent A; another tab then queued the same text again, without the file.
  dispatcherClaims('session-1');
  server.set('session-1', { text: '', queuedMessage: { content: 'follow-up A', attachments: [] } });

  await submit(view, 'follow-up B', [fileB]);

  assert.equal(view.result.current.queuedDraft?.content, 'follow-up A\n\nfollow-up B');
  assert.deepEqual(view.result.current.queuedDraft?.attachments.map((file) => file.name), ['b.txt']);
});

test('a refused follow-up goes back to the session it was typed in, after a switch during the upload', async () => {
  const { view, errors } = render();
  refuseQueueing = true;
  const upload = hold();
  uploadGate = upload.gate;
  await act(async () => {
    view.result.current.setInput('follow-up B');
    view.result.current.setAttachedFiles([new File(['b'], 'b.txt', { type: 'text/plain' })]);
  });
  const pending = startSubmit(view);
  view.rerender({ session: SESSION_2, isLoading: true, model: 'model-1' });
  await act(async () => {
    upload.release();
    await pending;
  });

  assert.equal(errors.length, 1);
  assert.equal(readDraftText('session-1'), 'follow-up B', 'it is waiting there to be sent again');
  assert.equal(view.result.current.input, '', 'and not in the composer of the session now open');
});

test('a follow-up refused after a switch made while it was being queued goes back to the session it was typed in', async () => {
  const { view, errors } = render();
  refuseQueueing = true;
  const response = hold();
  appendGate = response.gate;
  await act(async () => { view.result.current.setInput('follow-up A'); });
  const pending = startSubmit(view);
  await waitFor(() => assert.equal(appendRequestCount, 1));
  view.rerender({ session: SESSION_2, isLoading: true, model: 'model-1' });
  await act(async () => { view.result.current.setInput('typed in session 2'); });
  await act(async () => {
    response.release();
    await pending;
  });

  assert.equal(errors.length, 1);
  assert.equal(readDraftText('session-1'), 'follow-up A', 'it is waiting there to be sent again');
  assert.equal(view.result.current.input, 'typed in session 2', 'the composer now open is left alone');
  assert.equal(readDraftText('session-2'), 'typed in session 2');
});

test('a follow-up refused after a switch keeps the draft written meanwhile in the session it was typed in', async () => {
  const { view, errors } = render();
  refuseQueueing = true;
  const response = hold();
  appendGate = response.gate;
  await act(async () => { view.result.current.setInput('follow-up A'); });
  const pending = startSubmit(view);
  await waitFor(() => assert.equal(appendRequestCount, 1));
  view.rerender({ session: SESSION_2, isLoading: true, model: 'model-1' });
  // Another device changed that session's draft meanwhile.
  writeDraftText('session-1', 'written on the laptop');
  await act(async () => {
    response.release();
    await pending;
  });

  assert.equal(errors.length, 1);
  assert.equal(readDraftText('session-1'), 'follow-up A\n\nwritten on the laptop', 'both are kept, the refused one first');
});

test('a session switch during the upload keeps a draft that changed in the session left', async () => {
  const { view } = render();
  const upload = hold();
  uploadGate = upload.gate;
  await act(async () => {
    view.result.current.setInput('follow-up B');
    view.result.current.setAttachedFiles([new File(['b'], 'b.txt', { type: 'text/plain' })]);
  });
  const pending = startSubmit(view);
  view.rerender({ session: SESSION_2, isLoading: true, model: 'model-1' });
  // Another device changed that session's draft meanwhile.
  writeDraftText('session-1', 'written on the laptop');
  await act(async () => {
    upload.release();
    await pending;
  });

  assert.equal(queuedOnServer('session-1')?.content, 'follow-up B');
  assert.equal(readDraftText('session-1'), 'written on the laptop');
});
