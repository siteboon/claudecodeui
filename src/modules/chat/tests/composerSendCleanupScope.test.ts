import assert from 'node:assert/strict';

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, test, vi } from 'vitest';

import '@/modules/i18n';
import { useChatComposerState } from '@/modules/chat/hooks/useChatComposerState';
import { readDraftText, resetChatDrafts } from '@/shared/chatDrafts';
import type { PermissionMode, Project, ProjectSession, SessionActivityMap } from '@/shared/types';

/**
 * A send with attachments waits for the upload, and the user can open another
 * chat meanwhile. The cleanup after the send used to empty whichever chat was
 * open by then: its typed text, its draft and the files attached there (#1774).
 */

const PROJECT: Project = { projectId: 'project-1', displayName: 'Project One', fullPath: '/tmp/project-one' };
const SESSION_A: ProjectSession = { id: 'session-a' };
const SESSION_B: ProjectSession = { id: 'session-b' };

type Pending = { resolve: (response: Response) => void };
type Props = { session: ProjectSession | null };

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

let pendingUploads: Pending[] = [];
let pendingCreates: Pending[] = [];

const release = async (waiting: Pending[], body: unknown, status = 200) => {
  await act(async () => {
    for (const pending of waiting.splice(0)) pending.resolve(jsonResponse(body, status));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
};

const backgroundInA: SessionActivityMap = new Map([[
  'session-a',
  {
    statusText: null,
    canInterrupt: false,
    startedAt: 1,
    background: true,
    tasks: [{ taskId: 'a1', toolUseId: 'toolu_agent', taskType: 'local_agent', description: 'Survey', startedAt: 1 }],
  },
]]);

const renderComposer = (initialSession: ProjectSession | null, processingSessions?: SessionActivityMap) => {
  const sent: Array<{ type: string; sessionId?: string; content?: string; anchorId?: string }> = [];
  let rerender: ((props: Props) => void) | undefined;
  const view = renderHook(({ session }: Props) =>
    useChatComposerState({
      selectedProject: PROJECT,
      selectedSession: session,
      currentSessionId: session?.id ?? null,
      provider: 'claude',
      permissionMode: 'default',
      cyclePermissionMode: () => undefined,
      resolvePermissionModeForProvider: () => 'default' as PermissionMode,
      currentProviderModel: 'test-model',
      currentProviderEffort: 'medium',
      isLoading: false,
      processingSessions,
      supportsSideQuestions: true,
      canAbortSession: false,
      tokenBudget: null,
      sendMessage: (message) => { sent.push(message as { type: string }); },
      // The workspace selects the new session as soon as it exists.
      onSessionEstablished: (sessionId) => { rerender?.({ session: { id: sessionId } }); },
      scrollToBottom: () => undefined,
      addMessage: () => undefined,
      setIsUserScrolledUp: () => undefined,
      setPendingPermissionRequests: () => undefined,
    }),
  { initialProps: { session: initialSession } });
  rerender = view.rerender;
  return {
    view,
    chatSends: () => sent.filter((message) => message.type === 'chat.send'),
    editSends: () => sent.filter((message) => message.type === 'chat.edit-send'),
  };
};

const submit = (view: ReturnType<typeof renderComposer>['view']) =>
  view.result.current.handleSubmit({ preventDefault: () => undefined } as never);

beforeEach(() => {
  pendingUploads = [];
  pendingCreates = [];
  vi.stubGlobal('fetch', vi.fn((url: RequestInfo | URL, init?: RequestInit) => {
    if (String(url) === '/api/assets/files' && init?.method === 'POST') {
      return new Promise<Response>((resolve) => { pendingUploads.push({ resolve }); });
    }
    if (String(url) === '/api/providers/sessions' && init?.method === 'POST') {
      return new Promise<Response>((resolve) => { pendingCreates.push({ resolve }); });
    }
    return Promise.resolve(jsonResponse([]));
  }));
  resetChatDrafts();
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetChatDrafts();
});

test('a send finishing after a chat switch leaves the open chat alone', async () => {
  const { view, chatSends } = renderComposer(SESSION_A);
  const fileA = new File(['a'], 'a.txt');
  const fileB = new File(['b'], 'b.txt');
  await act(async () => {
    view.result.current.setInput('from a');
    view.result.current.setAttachedFiles([fileA]);
  });
  await act(async () => { void submit(view); });
  assert.equal(pendingUploads.length, 1, 'the send waits for the upload');

  await act(async () => { view.rerender({ session: SESSION_B }); });
  await act(async () => {
    view.result.current.setInput('typed in b');
    view.result.current.setAttachedFiles((files) => [...files, fileB]);
  });
  await release(pendingUploads, { attachments: [{ id: 'asset-a' }] });

  assert.deepEqual(chatSends().map((message) => [message.sessionId, message.content]), [['session-a', 'from a']]);
  assert.equal(readDraftText('session-a'), '', 'the sent chat\'s draft is cleared');
  assert.equal(view.result.current.input, 'typed in b', 'the open chat keeps its text');
  assert.equal(readDraftText('session-b'), 'typed in b', 'and its draft');
  assert.deepEqual(view.result.current.attachedFiles, [fileB], 'only the sent file is gone');
});

test('a new chat is still cleaned up once it has its session id', async () => {
  const { view, chatSends } = renderComposer(null);
  await act(async () => {
    view.result.current.setInput('first message');
    view.result.current.setAttachedFiles([new File(['a'], 'a.txt')]);
  });
  await act(async () => { void submit(view); });
  await release(pendingUploads, { attachments: [{ id: 'asset-a' }] });
  await release(pendingCreates, { success: true, data: { sessionId: 'session-new', sessionName: 'first' } }, 201);

  assert.deepEqual(chatSends().map((message) => [message.sessionId, message.content]), [['session-new', 'first message']]);
  assert.equal(view.result.current.input, '');
  assert.deepEqual(view.result.current.attachedFiles, []);
  assert.equal(readDraftText('project:project-1'), '');
  assert.equal(readDraftText('session-new'), '');
});

test('a side question asked for the sending chat after a chat switch leaves the open chat alone', async () => {
  const { view, chatSends } = renderComposer(SESSION_A, backgroundInA);
  await act(async () => {
    view.result.current.setInput('from a');
    view.result.current.setAttachedFiles([new File(['a'], 'a.txt')]);
  });
  await act(async () => { void submit(view); });
  await act(async () => { view.rerender({ session: SESSION_B }); });
  await act(async () => { view.result.current.setInput('typed in b'); });
  await release(pendingUploads, { attachments: [{ id: 'asset-a' }] });
  assert.ok(view.result.current.backgroundSendPrompt, 'the background-work dialog asks about the send');
  await act(async () => { view.result.current.resolveBackgroundSendPrompt('sideQuestion' as never); });

  assert.deepEqual(chatSends(), [], 'a side question is not a turn');
  assert.equal(readDraftText('session-a'), '', 'the asking chat\'s draft is cleared');
  assert.equal(view.result.current.input, 'typed in b', 'the open chat keeps its text');
  assert.equal(readDraftText('session-b'), 'typed in b', 'and its draft');
});

test('an edit begun in another chat during the upload survives the send', async () => {
  const { view, chatSends, editSends } = renderComposer(SESSION_A);
  await act(async () => {
    view.result.current.setInput('from a');
    view.result.current.setAttachedFiles([new File(['a'], 'a.txt')]);
  });
  await act(async () => { void submit(view); });
  await act(async () => { view.rerender({ session: SESSION_B }); });
  await act(async () => {
    view.result.current.beginEditMessage({ type: 'user', content: 'old b', transcriptAnchorId: 'anchor-b', timestamp: new Date() } as never);
  });
  await release(pendingUploads, { attachments: [{ id: 'asset-a' }] });

  assert.equal(view.result.current.editingAnchorId, 'anchor-b', 'the open chat is still editing');
  await act(async () => { view.result.current.setInput('new b'); });
  await act(async () => { await submit(view); });
  assert.deepEqual(chatSends().map((message) => message.sessionId), ['session-a']);
  assert.deepEqual(editSends().map((message) => [message.sessionId, message.anchorId]), [['session-b', 'anchor-b']]);
});
