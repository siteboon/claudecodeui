import assert from 'node:assert/strict';

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, beforeEach, test, vi } from 'vitest';

import '@/modules/i18n';
import { useChatComposerState } from '@/modules/chat/hooks/useChatComposerState';
import type { PermissionMode, Project } from '@/shared/types';

/**
 * The composer used to carry its own copy of the server's 10 MB attachment
 * limit (#1548). It now asks the server (GET /api/assets/limits), so an
 * operator who raises CHAT_ATTACHMENT_MAX_SIZE_MB does not also have to rebuild
 * the client. A refused file also has to say so: react-dropzone dropped an
 * oversized pick or drop without a word, and the "too large" text for a paste
 * was only ever attached to chips, which a refused file never gets.
 */

const PROJECT: Project = { projectId: 'project-1', displayName: 'Project One', fullPath: '/tmp/project-one' };
const MEGABYTE = 1024 * 1024;

let serverLimitBytes: number | null = null;
let limitResponses: Response[] = [];

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

type ComposerState = ReturnType<typeof useChatComposerState>;
let composer: ComposerState;

/**
 * Mounts the composer state with its dropzone wired to real elements, the way
 * ChatComposer does, and hands each render's state to the test after commit.
 */
function ComposerHarness({ onState }: { onState: (state: ComposerState) => void }) {
  const state = useChatComposerState({
    selectedProject: PROJECT,
    selectedSession: null,
    currentSessionId: null,
    provider: 'claude',
    permissionMode: 'default',
    cyclePermissionMode: () => undefined,
    resolvePermissionModeForProvider: () => 'default' as PermissionMode,
    currentProviderModel: 'test-model',
    currentProviderEffort: 'medium',
    isLoading: false,
    canAbortSession: false,
    tokenBudget: null,
    sendMessage: () => undefined,
    scrollToBottom: () => undefined,
    addMessage: () => undefined,
    setIsUserScrolledUp: () => undefined,
    setPendingPermissionRequests: () => undefined,
  });
  useEffect(() => {
    onState(state);
  });
  return (
    <div {...state.getRootProps()}>
      <input data-testid="attachment-input" {...state.getInputProps()} />
      {Array.from(state.fileErrors.values()).map((message) => <p key={message}>{message}</p>)}
    </div>
  );
}

const fileOfSize = (name: string, size: number, type = 'text/plain') => new File([new Uint8Array(size)], name, { type });

const limitRequests = () => vi.mocked(fetch).mock.calls.filter(([url]) => String(url) === '/api/assets/limits');

const mountWithServerLimit = async (limit: number | null) => {
  serverLimitBytes = limit;
  render(<ComposerHarness onState={(state) => { composer = state; }} />);
  await waitFor(() => assert.equal(limitRequests().length, 1));
  // The composer has read a limit once the response body is consumed; then let
  // the resulting state update land.
  if (limit !== null) {
    await waitFor(() => assert.ok(limitResponses[0]?.bodyUsed));
  }
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
};

const pickFiles = async (files: File[]) => {
  await act(async () => {
    fireEvent.change(screen.getByTestId('attachment-input'), { target: { files } });
  });
};

const pasteImages = (files: File[]) => {
  act(() => {
    composer.handlePaste({
      clipboardData: {
        items: files.map((file) => ({ type: file.type, getAsFile: () => file })),
        files: [],
      },
    } as never);
  });
};

beforeEach(() => {
  serverLimitBytes = null;
  limitResponses = [];
  vi.stubGlobal('fetch', vi.fn((url: RequestInfo | URL) => {
    if (String(url) === '/api/assets/limits') {
      const response = serverLimitBytes === null
        ? jsonResponse({ error: 'unavailable' }, 500)
        : jsonResponse({ maxFileSizeBytes: serverLimitBytes });
      limitResponses.push(response);
      return Promise.resolve(response);
    }
    return Promise.resolve(jsonResponse([]));
  }));
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

test('a picked file over the server limit is refused with a message naming the limit', async () => {
  await mountWithServerLimit(MEGABYTE);

  await pickFiles([fileOfSize('build.log', 2 * MEGABYTE)]);

  await waitFor(() => assert.ok(screen.getByText('build.log is too large to attach (max 1 MB)')));
  assert.deepEqual(composer.attachedFiles, []);
});

test('a file of exactly the server limit is attached', async () => {
  await mountWithServerLimit(MEGABYTE);

  await pickFiles([fileOfSize('exact.log', MEGABYTE)]);

  await waitFor(() => assert.deepEqual(composer.attachedFiles.map((file) => file.name), ['exact.log']));
  assert.equal(composer.fileErrors.size, 0);
});

test('a raised server limit lets a file over the old 10 MB through the picker', async () => {
  await mountWithServerLimit(20 * MEGABYTE);

  await pickFiles([fileOfSize('recording.webm', 11 * MEGABYTE, 'video/webm')]);

  await waitFor(() => assert.deepEqual(composer.attachedFiles.map((file) => file.name), ['recording.webm']));
});

test('pasted images are checked against the server limit as one batch', async () => {
  await mountWithServerLimit(MEGABYTE);

  pasteImages([
    fileOfSize('small.png', 1024, 'image/png'),
    fileOfSize('huge.png', MEGABYTE + 1, 'image/png'),
  ]);

  assert.deepEqual(composer.attachedFiles.map((file) => file.name), ['small.png']);
  assert.deepEqual(Array.from(composer.fileErrors.values()), ['huge.png is too large to attach (max 1 MB)']);
});

test('the next pick replaces an earlier refusal message', async () => {
  await mountWithServerLimit(MEGABYTE);

  await pickFiles([fileOfSize('build.log', 2 * MEGABYTE)]);
  await waitFor(() => assert.equal(composer.fileErrors.size, 1));

  await pickFiles([fileOfSize('notes.txt', 10)]);
  await waitFor(() => assert.deepEqual(composer.attachedFiles.map((file) => file.name), ['notes.txt']));
  assert.equal(composer.fileErrors.size, 0);
});

test('without a readable server limit nothing is refused locally; the upload enforces it', async () => {
  await mountWithServerLimit(null);

  await pickFiles([fileOfSize('big.log', 12 * MEGABYTE)]);

  await waitFor(() => assert.deepEqual(composer.attachedFiles.map((file) => file.name), ['big.log']));
  assert.equal(composer.fileErrors.size, 0);
});
