import assert from 'node:assert/strict';

import { useEffect } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, test, vi } from 'vitest';

import '@/modules/i18n';
import { useChatComposerState } from '@/modules/chat/hooks/useChatComposerState';
import AttachmentRejectionNotice from '@/modules/chat/composer/AttachmentRejectionNotice';
import { MAX_CHAT_ATTACHMENT_COUNT } from '@/shared/constants';
import type { PermissionMode, Project } from '@/shared/types';

/**
 * Attaching several files at once used to drop any file over the 10 MB limit
 * without a word: react-dropzone set it aside before `onDrop`, and the only
 * error state was keyed to chips the refused file never got. Picking more than
 * the count limit in one go refused the whole pick, also silently. Every
 * refused file must now be named, with its reason, while the rest attach.
 */

const PROJECT: Project = { projectId: 'project-1', displayName: 'Project One', fullPath: '/tmp/project-one' };
const MB = 1024 * 1024;

type ComposerState = ReturnType<typeof useChatComposerState>;
let latest: ComposerState;

// Renders the hook's real dropzone input, the one the paperclip opens, so the
// picker path goes through react-dropzone exactly as it does in the app.
function ComposerHarness() {
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
    onSessionEstablished: () => undefined,
    scrollToBottom: () => undefined,
    addMessage: () => undefined,
    setIsUserScrolledUp: () => undefined,
    setPendingPermissionRequests: () => undefined,
  });
  // Hands each render's state to the test; effects flush inside `act`.
  useEffect(() => {
    latest = state;
  });
  return (
    <div {...state.getRootProps()}>
      <input data-testid="attach-input" {...state.getInputProps()} />
    </div>
  );
}

// A file that reports `size` bytes without allocating them.
const fileOfSize = (name: string, size: number, type = 'application/pdf') => {
  const file = new File(['x'], name, { type });
  Object.defineProperty(file, 'size', { value: size });
  return file;
};

const pick = async (files: File[]) => {
  const input = screen.getByTestId('attach-input');
  await act(async () => {
    fireEvent.change(input, { target: { files } });
  });
};

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('[]', { status: 200 }))));
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

test('a file over the size limit in a multi-file pick is reported, and the rest attach', async () => {
  render(<ComposerHarness />);
  await pick([
    fileOfSize('notes.docx', 40 * 1024, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
    fileOfSize('medium.pdf', 5.5 * MB),
    fileOfSize('large.pdf', 12 * MB),
  ]);

  await waitFor(() => assert.equal(latest.attachedFiles.length, 2));
  assert.deepEqual(latest.attachedFiles.map((file) => file.name), ['notes.docx', 'medium.pdf']);
  assert.deepEqual(latest.attachmentRejections, [{ fileName: 'large.pdf', reason: 'too-large' }]);
});

test('picking more files than the limit attaches up to it and reports the rest, instead of refusing the whole pick', async () => {
  render(<ComposerHarness />);
  const files = Array.from({ length: MAX_CHAT_ATTACHMENT_COUNT + 1 }, (_, index) => fileOfSize(`note${index + 1}.txt`, 10, 'text/plain'));
  await pick(files);

  await waitFor(() => assert.equal(latest.attachedFiles.length, MAX_CHAT_ATTACHMENT_COUNT));
  assert.deepEqual(latest.attachmentRejections, [{ fileName: `note${MAX_CHAT_ATTACHMENT_COUNT + 1}.txt`, reason: 'too-many' }]);
});

test('a later pick that overfills the composer names the files left out', async () => {
  render(<ComposerHarness />);
  await pick(Array.from({ length: 8 }, (_, index) => fileOfSize(`a${index}.txt`, 10, 'text/plain')));
  await waitFor(() => assert.equal(latest.attachedFiles.length, 8));

  await pick(['b0.txt', 'b1.txt', 'b2.txt'].map((name) => fileOfSize(name, 10, 'text/plain')));

  await waitFor(() => assert.equal(latest.attachedFiles.length, MAX_CHAT_ATTACHMENT_COUNT));
  assert.deepEqual(latest.attachmentRejections, [{ fileName: 'b2.txt', reason: 'too-many' }]);
});

test('a clean pick clears the previous notice, and dismissing clears it too', async () => {
  render(<ComposerHarness />);
  await pick([fileOfSize('large.pdf', 12 * MB)]);
  await waitFor(() => assert.equal(latest.attachmentRejections.length, 1));

  await pick([fileOfSize('small.pdf', MB)]);
  await waitFor(() => assert.equal(latest.attachedFiles.length, 1));
  assert.deepEqual(latest.attachmentRejections, []);

  await pick([fileOfSize('large.pdf', 12 * MB)]);
  await waitFor(() => assert.equal(latest.attachmentRejections.length, 1));
  act(() => latest.dismissAttachmentRejections());
  assert.deepEqual(latest.attachmentRejections, []);
});

test('an oversized pasted image is reported rather than ignored', async () => {
  render(<ComposerHarness />);
  const image = fileOfSize('screenshot.png', 11 * MB, 'image/png');
  act(() => {
    latest.handlePaste({
      clipboardData: {
        items: [{ type: 'image/png', getAsFile: () => image }],
        files: [image],
      },
    } as never);
  });

  assert.equal(latest.attachedFiles.length, 0);
  assert.deepEqual(latest.attachmentRejections, [{ fileName: 'screenshot.png', reason: 'too-large' }]);
});

test('the notice names each refused file with its reason and can be dismissed', () => {
  const onDismiss = vi.fn();
  render(
    <AttachmentRejectionNotice
      rejections={[
        { fileName: 'large.pdf', reason: 'too-large' },
        { fileName: 'note11.txt', reason: 'too-many' },
      ]}
      onDismiss={onDismiss}
    />,
  );

  const notice = screen.getByRole('alert');
  assert.match(notice.textContent ?? '', /Couldn't attach 2 files/);
  assert.match(notice.textContent ?? '', /large\.pdf\s*is larger than 10 MB/);
  assert.match(notice.textContent ?? '', /note11\.txt\s*is over the 10-file limit/);

  fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
  assert.equal(onDismiss.mock.calls.length, 1);
});

test('the notice renders nothing when no file was refused', () => {
  const { container } = render(<AttachmentRejectionNotice rejections={[]} onDismiss={() => undefined} />);
  assert.equal(container.firstChild, null);
});
