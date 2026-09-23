import assert from 'node:assert/strict';

import { createRef } from 'react';
import type { ComponentProps } from 'react';
import { act, fireEvent, render } from '@testing-library/react';
import { test } from 'vitest';

import '@/modules/i18n';
import { TranscriptRenderContext } from '@/modules/chat/context/TranscriptRenderContext';
import ChatMessagesPane from '@/modules/chat/transcript/ChatMessagesPane';
import MessageComponent from '@/modules/chat/transcript/MessageComponent';
import { UiPreferencesProvider } from '@/shared/context/UiPreferencesContext';
import type { ChatMessage, DiffLine, Project } from '@/shared/types';

/**
 * Thinking rows used to mount collapsed with their open flag held inside the
 * row, so there was no way to have them land expanded, and a row the user had
 * opened snapped shut again whenever LazyMessageRow unmounted it (scrolled out
 * of its band as newer output pushed it up). The pane now resolves each row's
 * open state from the expandThinking preference plus the user's own clicks,
 * and owns it, so it outlives the row.
 *
 * The collapsed content stays in the DOM (the Collapsible animates a grid row
 * to 0fr), so visibility of the text proves nothing: the trigger's
 * aria-expanded is the signal.
 */

const createDiff = (): DiffLine[] => [];

const thinking = (id: string, content: string): ChatMessage => ({
  id,
  type: 'assistant',
  content,
  isThinking: true,
  timestamp: '2026-09-22T10:00:00.000Z',
});

const FIRST_THOUGHT = thinking('thought-1', 'Seventeen has no divisors between two and four.');
const SECOND_THOUGHT = thinking('thought-2', 'So it only divides by one and itself.');

const TRANSCRIPT: ChatMessage[] = [
  { id: 'user-1', type: 'user', content: 'Why is 17 prime?', timestamp: '2026-09-22T09:59:59.000Z' },
  FIRST_THOUGHT,
  { id: 'reply-1', type: 'assistant', content: 'Let me check.', timestamp: '2026-09-22T10:00:01.000Z' },
  SECOND_THOUGHT,
];

// Only the transcript's rows: the export menu's trigger carries aria-expanded too.
const thinkingTriggers = (container: HTMLElement) =>
  [...container.querySelectorAll<HTMLButtonElement>('.chat-message button[aria-expanded]')];

const openStates = (container: HTMLElement) =>
  thinkingTriggers(container).map((trigger) => trigger.getAttribute('aria-expanded'));

/* ─── MessageComponent ───────────────────────────────────────────── */

type RowProps = Partial<ComponentProps<typeof MessageComponent>>;

// MessageSpeakControl reads the voice preference, so the real provider is needed.
const renderRow = (props: RowProps = {}, isExporting = false) => (
  <UiPreferencesProvider>
    <TranscriptRenderContext.Provider value={{ isExporting }}>
      <MessageComponent
        message={FIRST_THOUGHT}
        prevMessage={null}
        createDiff={createDiff}
        provider="claude"
        showThinking
        {...props}
      />
    </TranscriptRenderContext.Provider>
  </UiPreferencesProvider>
);

test('a thinking row is collapsed unless told to open', () => {
  const { container } = render(renderRow());

  assert.deepEqual(openStates(container), ['false']);
});

test('a thinking row is open when the pane says so', () => {
  const { container } = render(renderRow({ thinkingOpen: true }));

  assert.deepEqual(openStates(container), ['true']);
});

test('clicking a thinking row reports the choice instead of flipping on its own', () => {
  const reported: Array<[ChatMessage, boolean]> = [];
  const { container } = render(
    renderRow({ onThinkingOpenChange: (message, open) => reported.push([message, open]) }),
  );

  fireEvent.click(thinkingTriggers(container)[0]);

  assert.deepEqual(reported, [[FIRST_THOUGHT, true]]);
  assert.deepEqual(openStates(container), ['false'], 'the pane owns the state, not the row');
});

test('a thinking row is always open in an export, where nothing can be clicked', () => {
  const { container } = render(renderRow({ thinkingOpen: false }, true));

  assert.deepEqual(openStates(container), ['true']);
});

/* ─── ChatMessagesPane ───────────────────────────────────────────── */

type PaneProps = ComponentProps<typeof ChatMessagesPane>;

const noop = () => {};

const PROJECT: Project = {
  projectId: 'project-1',
  displayName: 'triage-repo',
  fullPath: '/work/triage-repo',
};

const paneProps = (overrides: Partial<PaneProps>): PaneProps => {
  const messages = overrides.chatMessages ?? TRANSCRIPT;
  return {
    scrollContainerRef: createRef<HTMLDivElement>(),
    onWheel: noop,
    onTouchMove: noop,
    isLoadingSessionMessages: false,
    chatMessages: messages,
    selectedSession: null,
    currentSessionId: 'session-1',
    provider: 'claude',
    setProvider: noop,
    textareaRef: createRef<HTMLTextAreaElement>(),
    providerModels: { claude: '', cursor: '', codex: '', opencode: '' },
    setProviderModel: noop,
    providerModelCatalog: {},
    providerModelActions: {
      create: async () => {},
      update: async () => {},
      remove: async () => {},
    },
    providerModelsLoading: false,
    tasksEnabled: false,
    isTaskMasterInstalled: false,
    setInput: noop,
    isLoadingMoreMessages: false,
    hasMoreMessages: false,
    totalMessages: messages.length,
    sessionMessagesCount: messages.length,
    visibleMessageCount: messages.length,
    visibleMessages: messages,
    loadEarlierMessages: noop,
    revealMessage: noop,
    sendMessage: noop,
    loadAllMessages: noop,
    allMessagesLoaded: true,
    isLoadingAllMessages: false,
    loadAllJustFinished: false,
    showLoadAllOverlay: false,
    createDiff,
    onGrantToolPermission: () => ({ success: true }),
    selectedProject: PROJECT,
    showThinking: true,
    ...overrides,
  };
};

const renderPane = (overrides: Partial<PaneProps> = {}) => (
  <UiPreferencesProvider>
    <ChatMessagesPane {...paneProps(overrides)} />
  </UiPreferencesProvider>
);

test('with expandThinking on, every thinking row mounts open, including ones that arrive later', () => {
  const firstPart = TRANSCRIPT.slice(0, 3);
  const { container, rerender } = render(renderPane({ chatMessages: firstPart, expandThinking: true }));

  assert.deepEqual(openStates(container), ['true']);

  rerender(renderPane({ chatMessages: TRANSCRIPT, expandThinking: true }));

  assert.deepEqual(openStates(container), ['true', 'true']);
});

test('with expandThinking off, thinking rows stay collapsed', () => {
  const { container } = render(renderPane({ expandThinking: false }));

  assert.deepEqual(openStates(container), ['false', 'false']);
});

test('a thinking row opened by hand is still open after its row remounts', () => {
  const { container, rerender } = render(renderPane({ expandThinking: false }));

  fireEvent.click(thinkingTriggers(container)[0]);
  assert.deepEqual(openStates(container), ['true', 'false']);

  // Hiding thinking unmounts the Reasoning subtree exactly as LazyMessageRow
  // does for a row scrolled out of its band.
  rerender(renderPane({ expandThinking: false, showThinking: false }));
  assert.deepEqual(openStates(container), []);
  rerender(renderPane({ expandThinking: false, showThinking: true }));

  assert.deepEqual(openStates(container), ['true', 'false']);
});

test('a thinking row closed by hand stays closed while the others follow the preference', () => {
  const { container, rerender } = render(renderPane({ expandThinking: true }));

  fireEvent.click(thinkingTriggers(container)[0]);
  assert.deepEqual(openStates(container), ['false', 'true']);

  rerender(renderPane({ expandThinking: true, showThinking: false }));
  rerender(renderPane({ expandThinking: true, showThinking: true }));

  assert.deepEqual(openStates(container), ['false', 'true']);
});

test('flipping the preference re-applies it to every row, hand-touched ones included', () => {
  const { container, rerender } = render(renderPane({ expandThinking: false }));

  fireEvent.click(thinkingTriggers(container)[0]);
  assert.deepEqual(openStates(container), ['true', 'false']);

  act(() => {
    rerender(renderPane({ expandThinking: true }));
  });
  assert.deepEqual(openStates(container), ['true', 'true']);

  act(() => {
    rerender(renderPane({ expandThinking: false }));
  });
  assert.deepEqual(openStates(container), ['false', 'false']);
});
