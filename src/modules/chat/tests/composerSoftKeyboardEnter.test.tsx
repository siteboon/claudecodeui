import assert from 'node:assert/strict';

import { act, renderHook } from '@testing-library/react';
import type { KeyboardEvent } from 'react';
import { afterEach, beforeEach, test, vi } from 'vitest';

import { useChatComposerState } from '@/modules/chat/hooks/useChatComposerState';
import { resetChatDrafts } from '@/shared/chatDrafts';
import type { PermissionMode, Project, ProjectSession } from '@/shared/types';

/**
 * In Enter-to-send mode, plain Enter submitted the composer — which stranded
 * the newline on a phone or tablet: the on-screen keyboard's return key is
 * the only Enter there, it is labelled "new line", and Shift+Enter cannot be
 * typed without a physical Shift. These tests drive the real hook with the
 * `(pointer: coarse)` media query flipped, so the guard is exercised at the
 * keydown that ships, not described.
 */

const PROJECT: Project = {
  projectId: 'project-1',
  displayName: 'Project One',
  fullPath: '/tmp/project-one',
};

const SESSION: ProjectSession = { id: 'session-send' };

vi.mock('@/shared/api', () => {
  const okJson = (data: unknown) => Promise.resolve({ ok: true, json: async () => data });
  return {
    api: {
      user: {
        drafts: () => okJson({ success: true, drafts: [] }),
        saveDraft: () => okJson({ success: true }),
        deleteDraft: () => okJson({ success: true }),
        preferences: () => okJson({ success: true, preferences: {} }),
        savePreferences: () => okJson({ success: true, preferences: {} }),
      },
      commands: { list: () => okJson({ success: true, commands: [] }) },
      providers: { skills: () => okJson({ success: true, skills: [] }) },
      files: { search: () => okJson({ success: true, files: [] }) },
      getFiles: () => okJson({ success: true, data: [] }),
    },
  };
});

// vitest.setup.ts installs a matchMedia that reports `matches: false` for
// every query (the desktop layout). The pointer environment is the input
// under test here, so each case installs its own answer for it.
let coarsePointer = false;
/** Installs a matchMedia whose only truthful query is `(pointer: coarse)` — and only while {@link coarsePointer} is set — leaving every other query desktop-shaped. */
const installMatchMedia = () => {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query === '(pointer: coarse)' && coarsePointer,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }));
};

/** Builds a synthetic textarea Enter keydown, tracking whether it was cancelled. */
const enterEvent = (overrides: { shiftKey?: boolean; ctrlKey?: boolean } = {}) => {
  let defaultPrevented = false;
  return {
    event: {
      key: 'Enter',
      shiftKey: false,
      ctrlKey: false,
      metaKey: false,
      nativeEvent: { isComposing: false },
      preventDefault: () => {
        defaultPrevented = true;
      },
      ...overrides,
    } as unknown as KeyboardEvent<HTMLTextAreaElement>,
    wasPrevented: () => defaultPrevented,
  };
};

/** Mounts the composer hook against an open session and a recording sendMessage. */
const renderComposer = (sendMessage: ReturnType<typeof vi.fn>, sendByCtrlEnter?: boolean) => renderHook(
  () => useChatComposerState({
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
    canAbortSession: false,
    tokenBudget: null,
    sendMessage,
    sendByCtrlEnter,
    scrollToBottom: () => undefined,
    addMessage: () => undefined,
    setIsUserScrolledUp: () => undefined,
    setPendingPermissionRequests: () => undefined,
  }),
);

/** Types text into the composer the way a keyboard would, then presses a key. */
const typeAndPress = async (
  view: ReturnType<typeof renderComposer>,
  key: ReturnType<typeof enterEvent>,
) => {
  await act(async () => {
    view.result.current.setInput('hello world');
  });
  await act(async () => {
    view.result.current.handleKeyDown(key.event);
  });
};

beforeEach(() => {
  localStorage.clear();
  // The drafts store is a module-level singleton; its in-memory copy outlives
  // localStorage.clear() and would leak one test's draft into the next.
  resetChatDrafts();
  coarsePointer = false;
  installMatchMedia();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

test('a fine pointer keeps plain Enter as the send key', async () => {
  const sendMessage = vi.fn();
  const view = renderComposer(sendMessage);
  const enter = enterEvent();

  await typeAndPress(view, enter);

  assert.equal(sendMessage.mock.calls.length, 1);
  assert.equal(sendMessage.mock.calls[0][0].type, 'chat.send');
});

test('on a soft keyboard, plain Enter is left to insert the newline', async () => {
  coarsePointer = true;
  const sendMessage = vi.fn();
  const view = renderComposer(sendMessage);
  const enter = enterEvent();

  await typeAndPress(view, enter);

  // No submit, and no preventDefault either: the uncancelled keydown is what
  // puts the line break into the textarea.
  assert.equal(sendMessage.mock.calls.length, 0);
  assert.equal(enter.wasPrevented(), false);
});

test('a physical keyboard paired to a tablet keeps its Ctrl+Enter chord', async () => {
  coarsePointer = true;
  const sendMessage = vi.fn();
  const view = renderComposer(sendMessage);

  await typeAndPress(view, enterEvent({ ctrlKey: true }));

  assert.equal(sendMessage.mock.calls.length, 1);
});

test('Shift+Enter stays a newline in every environment', async () => {
  coarsePointer = true;
  const sendMessage = vi.fn();
  const view = renderComposer(sendMessage);

  await typeAndPress(view, enterEvent({ shiftKey: true }));

  assert.equal(sendMessage.mock.calls.length, 0);
});
