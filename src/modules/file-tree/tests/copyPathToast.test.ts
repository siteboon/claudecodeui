import assert from 'node:assert/strict';

import { act, renderHook } from '@testing-library/react';
import { afterEach, test, vi } from 'vitest';

import { useFileTreeOperations } from '@/modules/file-tree/hooks/useFileTreeOperations';
import type { FileTreeNode } from '@/shared/types';

/**
 * Copy Path used to call the Clipboard API with no fallback and show "Path copied"
 * before the write had answered, then "Failed to copy path" over it when the write
 * was rejected (#1642). The path must now reach the clipboard through the same
 * textarea fallback the other copy actions use, and exactly one toast must follow
 * what really happened.
 */

// Hands back the key and the English default, so the assertions read like the toasts
// and still pin the translation keys every locale provides.
vi.mock('react-i18next', () => {
  const t = (key: string, defaultValue: string) => `[${key}] ${defaultValue}`;
  return { useTranslation: () => ({ t }) };
});

const FILE: FileTreeNode = { name: 'a.txt', type: 'file', path: '/repo/src/a.txt' };
const COPIED_TOAST = ['[fileTree.toast.pathCopied] Path copied to clipboard', 'success'];
const FAILED_TOAST = ['[fileTree.toast.copyFailed] Failed to copy path', 'error'];

type ClipboardStub = { writeText: (text: string) => Promise<void> };

const writeDenied = () => new DOMException('Write permission denied.', 'NotAllowedError');

const stubClipboardApi = (clipboard: ClipboardStub | undefined) => {
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: clipboard });
};

// jsdom has no working `execCommand('copy')`, so the stub records what the hidden
// textarea held when the fallback asked the browser to copy it.
const stubExecCommand = (copies: boolean) => {
  const fallback = { calls: 0, copiedText: null as string | null };
  Object.defineProperty(document, 'execCommand', {
    configurable: true,
    value: (command: string) => {
      fallback.calls += 1;
      const field = document.activeElement;
      if (command === 'copy' && copies && field instanceof HTMLTextAreaElement) {
        fallback.copiedText = field.value;
      }
      return copies;
    },
  });
  return fallback;
};

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const renderOperations = () => {
  const showToast = vi.fn<(message: string, type: 'success' | 'error') => void>();
  const { result } = renderHook(() => useFileTreeOperations({
    selectedProject: null,
    onRefresh: () => {},
    showToast,
  }));
  return { result, toasts: () => showToast.mock.calls };
};

const copyPath = async () => {
  const { result, toasts } = renderOperations();
  await act(async () => {
    result.current.handleCopyPath(FILE);
    await settle();
  });
  return toasts();
};

afterEach(() => {
  // Drop the own-property stubs so jsdom's own (missing) implementations show again.
  Reflect.deleteProperty(navigator, 'clipboard');
  Reflect.deleteProperty(document, 'execCommand');
});

test('a rejected Clipboard API write falls back to the textarea copy and shows only the success toast', async () => {
  stubClipboardApi({ writeText: () => Promise.reject(writeDenied()) });
  const fallback = stubExecCommand(true);

  const toasts = await copyPath();

  assert.deepEqual(toasts, [COPIED_TOAST]);
  assert.equal(fallback.copiedText, FILE.path);
});

test('without the Clipboard API (plain-HTTP access) the fallback copies the path', async () => {
  stubClipboardApi(undefined);
  const fallback = stubExecCommand(true);

  const toasts = await copyPath();

  assert.equal(fallback.copiedText, FILE.path);
  assert.deepEqual(toasts, [COPIED_TOAST]);
});

test('when the fallback cannot copy either, only the error toast shows', async () => {
  stubClipboardApi({ writeText: () => Promise.reject(writeDenied()) });
  const fallback = stubExecCommand(false);

  const toasts = await copyPath();

  assert.deepEqual(toasts, [FAILED_TOAST]);
  assert.equal(fallback.calls, 1);
});

test('a working Clipboard API copies the path without the fallback', async () => {
  const written: string[] = [];
  stubClipboardApi({ writeText: async (text) => { written.push(text); } });
  const fallback = stubExecCommand(true);

  const toasts = await copyPath();

  assert.deepEqual(written, [FILE.path]);
  assert.equal(fallback.calls, 0);
  assert.deepEqual(toasts, [COPIED_TOAST]);
});

test('no toast shows while the Clipboard API has not answered yet', async () => {
  let rejectWrite: (reason: unknown) => void = () => {};
  const writes: string[] = [];
  stubClipboardApi({
    writeText: (text) => {
      writes.push(text);
      return new Promise<void>((_resolve, reject) => { rejectWrite = reject; });
    },
  });
  const fallback = stubExecCommand(true);
  const { result, toasts } = renderOperations();

  await act(async () => {
    result.current.handleCopyPath(FILE);
    // The write must start inside the click handler: browsers only allow clipboard
    // writes while the click still counts as a user activation.
    assert.deepEqual(writes, [FILE.path]);
    await settle();
  });
  assert.equal(toasts().length, 0);

  // A browser's permission check answers after the click handler has returned.
  await act(async () => {
    rejectWrite(writeDenied());
    await settle();
  });
  assert.equal(fallback.copiedText, FILE.path);
  assert.deepEqual(toasts(), [COPIED_TOAST]);
});
