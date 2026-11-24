import assert from 'node:assert/strict';

import { createRef } from 'react';
import type { ComponentProps } from 'react';
import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeEach, test, vi } from 'vitest';

import '@/modules/i18n';
import ChatComposer from '@/modules/chat/composer/ChatComposer';
import ChatMessagesPane from '@/modules/chat/transcript/ChatMessagesPane';
import { useEscapeToAbortSession } from '@/modules/chat/hooks/useEscapeToAbortSession';
import { UiPreferencesProvider } from '@/shared/context/UiPreferencesContext';
import type { Project, ProviderModelActions } from '@/shared/types';

// Avoid importing xterm CSS/WebGL in jsdom when ChatMessagesPane pulls the task-master barrel.
vi.mock('@/modules/shell', () => ({ Shell: () => null }));

type Props = ComponentProps<typeof ChatComposer>;
const noop = () => undefined;
const props = (overrides: Partial<Props> = {}): Props => ({
  pendingPermissionRequests: [], handlePermissionDecision: noop,
  handleGrantToolPermission: () => ({ success: true }), activity: null,
  isLoading: false, onAbortSession: noop, permissionMode: 'default',
  availablePermissionModes: ['default'], onSelectPermissionMode: noop,
  providerLabel: 'Claude', effort: 'medium', availableEffortOptions: [],
  onSelectEffort: noop, model: 'test-model', availableModelOptions: [],
  onSelectModel: noop, modelsLoading: false, tokenBudget: null,
  onShowTokenUsage: noop, slashCommandsCount: 0, onToggleCommandMenu: noop,
  hasInput: true, onClearInput: noop, onSubmit: noop, isDragActive: false,
  queuedDraft: null, backgroundSendPrompt: null, onResolveBackgroundSendPrompt: noop,
  isEditingSentMessage: false, onCancelEditMessage: noop, scheduledMessages: [],
  onScheduleMessage: noop, onCancelScheduledMessage: noop, onEditQueuedDraft: noop,
  onDeleteQueuedDraft: noop, attachedFiles: [], onRemoveAttachment: noop,
  attachmentRejections: [], onDismissAttachmentRejections: noop,
  showFileDropdown: false, filteredFiles: [], selectedFileIndex: -1, onSelectFile: noop,
  filteredCommands: [], selectedCommandIndex: -1, onCommandSelect: noop,
  onCloseCommandMenu: noop, isCommandMenuOpen: false, frequentCommands: [],
  getRootProps: () => ({}), getInputProps: () => ({ type: 'file', hidden: true }),
  openAttachmentPicker: noop, inputHighlightRef: createRef<HTMLDivElement>(),
  renderInputWithMentions: (text) => text, textareaRef: createRef<HTMLTextAreaElement>(),
  input: 'Draft message', onInputChange: noop, onTextareaClick: noop,
  onTextareaKeyDown: noop, onTextareaPaste: noop, onTextareaScrollSync: noop,
  onTextareaInput: noop, placeholder: 'Message', isTextareaExpanded: false,
  onToggleCompactMode: noop, ...overrides,
});
const view = (value: Props) => <UiPreferencesProvider><ChatComposer {...value} /></UiPreferencesProvider>;

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', {
    status: 200, headers: { 'Content-Type': 'application/json' },
  })));
});

afterEach(() => vi.unstubAllGlobals());

test('hides and restores permission label based on available width in normal and compact modes', () => {
  let compact = false;
  let room = 700;
  const observers = new Set<() => void>();
  vi.spyOn(Element.prototype, 'clientWidth', 'get').mockImplementation(function (this: Element) {
    if (this.matches('[data-slot="prompt-input-footer"]')) return compact ? 0 : room;
    if (this.classList.contains('composer-options')) return room;
    return 0;
  });
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const namedTrigger = (element: Element) => element.querySelector('button[aria-label^="Default Mode:"]');
    const triggerWidth = (element: Element | null) => element?.textContent ? 112 : 32;
    let width = 0;
    if (this.matches('[data-slot="prompt-input-tools"]')) width = 210;
    else if (this.classList.contains('composer-secondary-actions')) width = 180 + triggerWidth(namedTrigger(this));
    else if (this.classList.contains('composer-send-actions')) width = 80;
    else if (this.matches('button[aria-label^="Default Mode:"]')) width = triggerWidth(this);
    return { x: 0, y: 0, top: 0, left: 0, right: width, bottom: 32, width, height: 32, toJSON: () => ({}) };
  });
  vi.stubGlobal('ResizeObserver', class {
    constructor(readonly callback: () => void) {}
    observe() { observers.add(this.callback); }
    disconnect() { observers.delete(this.callback); }
  });
  const value = props();
  const { rerender } = render(view(value));
  const trigger = screen.getByRole('button', { name: /^Default Mode:/ });
  assert.equal(trigger.textContent, 'Default Mode');
  act(() => { room = 350; for (const callback of observers) callback(); });
  assert.equal(trigger.textContent, '');
  compact = true;
  rerender(view({ ...value, compactMode: true }));
  fireEvent.click(screen.getByRole('button', { name: 'More chat tools' }));
  act(() => { room = 270; for (const callback of observers) callback(); });
  assert.equal(trigger.textContent, '', 'compact mode must not measure the layout-less footer');
  act(() => { room = 620; for (const callback of observers) callback(); });
  assert.equal(trigger.textContent, 'Default Mode');
});

test('toggling compact mode preserves the same textarea node, draft, and attachments', () => {
  const value = props({ attachedFiles: [new File(['note'], 'notes.txt', { type: 'text/plain' })] });
  const { rerender } = render(view(value));
  const textarea = screen.getByPlaceholderText('Message');
  textarea.focus();
  fireEvent.compositionStart(textarea);
  rerender(view({ ...value, compactMode: true }));
  assert.equal(screen.getByPlaceholderText('Message'), textarea);
  assert.equal((textarea as HTMLTextAreaElement).value, value.input);
  assert.equal(document.activeElement, textarea);
  assert.ok(screen.getByText('notes.txt'));
  fireEvent.compositionEnd(textarea);
  rerender(view(value));
  assert.equal(screen.getByPlaceholderText('Message'), textarea);
});

test('compact mode keeps quick actions and model picker visible, toggles secondary tools, and closes tools on Escape', () => {
  const abort = vi.fn();
  const openDrawer = vi.fn();
  const selectModel = vi.fn();
  const value = props({
    compactMode: true,
    isLoading: true,
    onAbortSession: abort,
    availableModelOptions: [
      { value: 'gemini-4', label: 'Gemini 4' },
      { value: 'claude-sonnet', label: 'Claude Sonnet' },
    ],
    model: 'gemini-4',
    onSelectModel: selectModel,
    compactLeadingAction: (
      <button type="button" onClick={openDrawer} aria-label="Open menu">
        Menu
      </button>
    ),
  });
  const { container, rerender } = render(view(value));
  renderHook(() => useEscapeToAbortSession({
    canAbortSession: true, onAbortSession: abort, composerRef: value.textareaRef,
  }));
  const textarea = screen.getByPlaceholderText('Message') as HTMLTextAreaElement;
  assert.equal(textarea.getAttribute('rows'), '1');
  const quickActions = container.querySelector('.composer-compact-quick-actions');
  const sendActions = container.querySelector('.composer-send-actions');
  assert.ok(quickActions);
  assert.ok(sendActions);
  const menuButton = screen.getByRole('button', { name: 'Open menu' });
  const attachButton = screen.getByRole('button', { name: 'Attach files' });
  const tokenButton = screen.getByRole('button', { name: 'Show token usage' });
  const modelButton = screen.getByRole('button', { name: 'Select model and reasoning effort' });
  assert.ok(quickActions.contains(menuButton));
  assert.ok(quickActions.contains(attachButton));
  assert.ok(quickActions.contains(tokenButton));
  assert.ok(sendActions.contains(modelButton));
  fireEvent.click(menuButton);
  assert.equal(openDrawer.mock.calls.length, 1);

  fireEvent.click(modelButton);
  fireEvent.click(screen.getByRole('menuitem', { name: 'Gemini 4' }));
  fireEvent.click(screen.getByRole('menuitemradio', { name: 'Claude Sonnet' }));
  assert.deepEqual(selectModel.mock.calls, [['claude-sonnet']]);

  const more = screen.getByRole('button', { name: 'More chat tools' });
  assert.equal(more.getAttribute('aria-expanded'), 'false');
  assert.equal(screen.queryByRole('button', { name: /^Default Mode:/ }), null);
  fireEvent.click(more);
  assert.equal(more.getAttribute('aria-expanded'), 'true');
  assert.equal(screen.getAllByRole('button', { name: 'Open menu' }).length, 1);
  assert.equal(screen.getAllByRole('button', { name: 'Attach files' }).length, 1);
  assert.equal(screen.getAllByRole('button', { name: 'Show token usage' }).length, 1);
  assert.equal(screen.getAllByRole('button', { name: 'Select model and reasoning effort' }).length, 1);
  assert.ok(screen.getByRole('button', { name: /^Default Mode:/ }));
  fireEvent.keyDown(more, { key: 'Escape' });
  assert.equal(more.getAttribute('aria-expanded'), 'false');
  assert.equal(abort.mock.calls.length, 0);

  rerender(view({ ...value, compactMode: false }));
  const secondaryActions = container.querySelector('.composer-secondary-actions');
  assert.ok(secondaryActions?.contains(screen.getByRole('button', { name: 'Select model and reasoning effort' })));
});

test('compact mode stop button immediately invokes the abort handler', () => {
  const abort = vi.fn();
  render(view(props({ compactMode: true, isLoading: true, input: '', hasInput: false, onAbortSession: abort })));
  fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
  assert.equal(abort.mock.calls.length, 1);
});

test('compact mode keeps permission actions operable and exit button reachable', () => {
  const decide = vi.fn();
  const exit = vi.fn();
  render(view(props({
    compactMode: true, onToggleCompactMode: exit, handlePermissionDecision: decide,
    pendingPermissionRequests: [{ requestId: 'permission-1', toolName: 'Bash', input: { command: 'pwd' } }],
  })));
  assert.ok(screen.getByText('Permission required'));
  const allow = screen.getAllByRole('button').find((button) => button.textContent === 'Allow once');
  assert.ok(allow);
  fireEvent.click(allow);
  assert.equal(decide.mock.calls.length, 1);
  fireEvent.click(screen.getByRole('button', { name: 'Exit compact mode' }));
  assert.equal(exit.mock.calls.length, 1);
});

test('exit compact mode and navigation controls stay available when a question panel replaces the input', () => {
  const exit = vi.fn();
  const openDrawer = vi.fn();
  const openFiles = vi.fn();
  render(view(props({
    compactMode: true,
    onToggleCompactMode: exit,
    compactLeadingAction: (
      <button type="button" onClick={openDrawer} aria-label="Open menu">
        Menu
      </button>
    ),
    compactNavigation: (
      <button type="button" onClick={openFiles}>
        Files tab
      </button>
    ),
    pendingPermissionRequests: [{ requestId: 'question-1', toolName: 'AskUserQuestion', input: {
      questions: [{ question: 'Continue?', header: 'Choice', options: [
        { label: 'Proceed', description: 'Continue task' }, { label: 'Pause', description: 'Pause task' },
      ], multiSelect: false }],
    } }],
  })));
  assert.equal(screen.queryByPlaceholderText('Message'), null);
  fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));
  assert.equal(openDrawer.mock.calls.length, 1);
  fireEvent.click(screen.getByRole('button', { name: 'Files tab' }));
  assert.equal(openFiles.mock.calls.length, 1);
  fireEvent.click(screen.getByRole('button', { name: 'Exit compact mode' }));
  assert.equal(exit.mock.calls.length, 1);
});

test('compact mode keeps pointer events on floating cards and applies measured bottom inset to transcript pane', () => {
  const { container: composerRoot } = render(view(props({
    compactMode: true,
    queuedDraft: { content: 'Queued follow-up', attachments: [] },
    isEditingSentMessage: true,
    scheduledMessages: [{
      id: 'sched-1',
      sessionId: 's1',
      content: 'Scheduled message',
      options: {},
      scheduledFor: new Date().toISOString(),
      status: 'pending',
      failureReason: null,
      createdAt: new Date().toISOString(),
    }],
  })));

  const shell = composerRoot.querySelector('.chat-composer-shell');
  assert.equal(shell?.getAttribute('data-compact'), 'true');
  assert.ok(shell?.querySelector('.composer-floating-surface'));
  assert.equal(shell?.querySelectorAll('.composer-floating-card').length, 3);

  const paneProject: Project = { projectId: 'p1', path: '/repo', fullPath: '/repo', displayName: 'Repo' };
  const asyncNoop = async () => undefined;
  const providerModelActions: ProviderModelActions = {
    create: asyncNoop,
    update: asyncNoop,
    remove: asyncNoop,
    setCustomModelsOnly: asyncNoop,
  };
  const paneProps: ComponentProps<typeof ChatMessagesPane> = {
    scrollContainerRef: createRef<HTMLDivElement>() as ComponentProps<typeof ChatMessagesPane>['scrollContainerRef'],
    onWheel: noop,
    onTouchMove: noop,
    isLoadingSessionMessages: false,
    isProcessing: false,
    hasActivityIndicator: false,
    chatMessages: [],
    selectedSession: null,
    currentSessionId: null,
    provider: 'claude',
    setProvider: noop,
    textareaRef: createRef<HTMLTextAreaElement>() as ComponentProps<typeof ChatMessagesPane>['textareaRef'],
    providerModels: { claude: '', cursor: '', codex: '', opencode: '' },
    setProviderModel: noop,
    providerModelCatalog: {},
    providerModelActions,
    providerModelsLoading: false,
    tasksEnabled: false,
    isTaskMasterInstalled: false,
    setInput: noop,
    isLoadingMoreMessages: false,
    hasMoreMessages: false,
    totalMessages: 0,
    sessionMessagesCount: 0,
    visibleMessageCount: 100,
    visibleMessages: [],
    loadEarlierMessages: noop,
    revealMessage: noop,
    sendMessage: noop,
    loadAllMessages: noop,
    allMessagesLoaded: false,
    isLoadingAllMessages: false,
    loadAllJustFinished: false,
    showLoadAllOverlay: false,
    createDiff: noop,
    onGrantToolPermission: () => ({ success: true }),
    selectedProject: paneProject,
  };

  const { container: paneRoot, rerender } = render(
    <ChatMessagesPane {...paneProps} isCompactFloating floatingBottomInset={136} />,
  );
  const pane = paneRoot.querySelector('.chat-messages-pane') as HTMLElement | null;
  assert.equal(pane?.style.paddingBottom, '136px');

  rerender(<ChatMessagesPane {...paneProps} isCompactFloating floatingBottomInset={0} hasActivityIndicator />);
  assert.equal(pane?.style.paddingBottom, '');
  assert.ok(pane?.className.includes('pb-32'));

  rerender(<ChatMessagesPane {...paneProps} isCompactFloating={false} floatingBottomInset={0} hasActivityIndicator={false} />);
  assert.ok(pane?.className.includes('pb-3'));
});
