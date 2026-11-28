import assert from 'node:assert/strict';

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, test, vi } from 'vitest';

import '@/modules/i18n';
import { useChatComposerState } from '@/modules/chat/hooks/useChatComposerState';
import { resetChatDrafts } from '@/shared/chatDrafts';
import type { PermissionMode, Project, ProjectSession } from '@/shared/types';

/**
 * Pending attachments belong to the chat they were attached in. The composer is
 * one mounted instance across session switches, so a single shared list showed
 * an image pasted in one conversation in whichever conversation was opened
 * next — and a send there took the image along. Attach-rejection notices were
 * shared the same way.
 */

const PROJECT: Project = { projectId: 'project-1', displayName: 'Project One', fullPath: '/tmp/project-one' };
const SESSION_A: ProjectSession = { id: 'session-a' };
const SESSION_B: ProjectSession = { id: 'session-b' };
const MB = 1024 * 1024;

type Props = { session: ProjectSession | null };
type Sent = { type: string; sessionId?: string; options?: { attachments?: unknown[] } };

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

// A file that reports `size` bytes without allocating them.
const fileOfSize = (name: string, size: number, type: string) => {
  const file = new File(['x'], name, { type });
  Object.defineProperty(file, 'size', { value: size });
  return file;
};

let assetUploads = 0;
let sent: Sent[] = [];

const renderComposer = (initialSession: ProjectSession | null) => {
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
      canAbortSession: false,
      tokenBudget: null,
      sendMessage: (message) => {
        sent.push(message as Sent);
        return true;
      },
      scrollToBottom: () => undefined,
      addMessage: () => undefined,
      setIsUserScrolledUp: () => undefined,
      setPendingPermissionRequests: () => undefined,
    }),
  { initialProps: { session: initialSession } });
  return view;
};

type ComposerView = ReturnType<typeof renderComposer>;

const pasteImage = (view: ComposerView, file: File) => {
  act(() => {
    view.result.current.handlePaste({
      clipboardData: {
        items: [{ type: file.type, getAsFile: () => file }],
        files: [file],
      },
    } as never);
  });
};

const switchTo = async (view: ComposerView, session: ProjectSession) => {
  await act(async () => { view.rerender({ session }); });
};

const submit = (view: ComposerView) =>
  view.result.current.handleSubmit({ preventDefault: () => undefined } as never);

beforeEach(() => {
  assetUploads = 0;
  sent = [];
  vi.stubGlobal('fetch', vi.fn((url: RequestInfo | URL, init?: RequestInit) => {
    if (String(url) === '/api/assets/files' && init?.method === 'POST') {
      assetUploads += 1;
      return Promise.resolve(jsonResponse({ attachments: [{ id: 'asset-a' }] }));
    }
    return Promise.resolve(jsonResponse([]));
  }));
  resetChatDrafts();
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetChatDrafts();
});

test('a pasted image stays in its own chat when the user opens another conversation', async () => {
  const view = renderComposer(SESSION_A);
  pasteImage(view, new File(['png'], 'pasted.png', { type: 'image/png' }));
  assert.deepEqual(view.result.current.attachedFiles.map((file) => file.name), ['pasted.png']);

  await switchTo(view, SESSION_B);
  assert.equal(view.result.current.attachedFiles.length, 0, 'the opened chat starts without it');

  await switchTo(view, SESSION_A);
  assert.deepEqual(
    view.result.current.attachedFiles.map((file) => file.name),
    ['pasted.png'],
    'coming back finds it still pending',
  );
});

test('a send in another chat does not take the image pasted in the chat left behind', async () => {
  const view = renderComposer(SESSION_A);
  pasteImage(view, new File(['png'], 'pasted.png', { type: 'image/png' }));

  await switchTo(view, SESSION_B);
  await act(async () => { view.result.current.setInput('from b'); });
  await act(async () => { await submit(view); });

  assert.equal(assetUploads, 0, 'nothing was uploaded for the open chat');
  assert.deepEqual(sent.map((message) => message.sessionId), ['session-b']);
  assert.deepEqual(sent[0]?.options?.attachments, [], 'the send carries no attachments');

  await switchTo(view, SESSION_A);
  assert.deepEqual(
    view.result.current.attachedFiles.map((file) => file.name),
    ['pasted.png'],
    'the chat it was pasted in still holds it',
  );
});

test('an attach refusal notice stays with the chat whose attempt produced it', async () => {
  const view = renderComposer(SESSION_A);
  pasteImage(view, fileOfSize('huge.png', 11 * MB, 'image/png'));
  assert.deepEqual(view.result.current.attachmentRejections, [{ fileName: 'huge.png', reason: 'too-large' }]);

  await switchTo(view, SESSION_B);
  assert.deepEqual(view.result.current.attachmentRejections, [], 'the opened chat has no stale notice');

  pasteImage(view, new File(['png'], 'small.png', { type: 'image/png' }));
  assert.deepEqual(view.result.current.attachedFiles.map((file) => file.name), ['small.png']);

  await switchTo(view, SESSION_A);
  assert.deepEqual(view.result.current.attachmentRejections, [{ fileName: 'huge.png', reason: 'too-large' }]);
  assert.deepEqual(view.result.current.attachedFiles, [], 'and the notice did not leave its image behind');
});
