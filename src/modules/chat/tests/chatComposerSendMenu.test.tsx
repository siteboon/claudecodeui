import assert from 'node:assert/strict';

import { createRef } from 'react';
import type { ComponentProps } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, test, vi } from 'vitest';

import '@/modules/i18n';
import ChatComposer from '@/modules/chat/composer/ChatComposer';
import { UiPreferencesProvider } from '@/shared/context/UiPreferencesContext';
import type { SessionActivity } from '@/shared/types';

/**
 * Where the composer draws the send menu: in place of the send button while a
 * turn is written or only background work runs, never while idle. Stop in the
 * menu is the existing abort.
 *
 * Every prop below is a stub of the composer's current interface; only
 * `isLoading`, `activity`, `input`/`hasInput` and `onAbortSession` matter here.
 */

type Props = ComponentProps<typeof ChatComposer>;

const BACKGROUND: SessionActivity = { statusText: null, canInterrupt: false, startedAt: 1, background: true, tasks: [] };

const props = (overrides: Partial<Props>): Props => ({
  pendingPermissionRequests: [],
  handlePermissionDecision: () => undefined,
  handleGrantToolPermission: () => ({ success: true }),
  activity: null,
  isLoading: false,
  onAbortSession: () => undefined,
  permissionMode: 'default',
  availablePermissionModes: ['default'],
  onSelectPermissionMode: () => undefined,
  providerLabel: 'Claude',
  effort: 'medium',
  availableEffortOptions: [],
  onSelectEffort: () => undefined,
  model: 'test-model',
  availableModelOptions: [],
  onSelectModel: () => undefined,
  modelsLoading: false,
  tokenBudget: null,
  onShowTokenUsage: () => undefined,
  slashCommandsCount: 0,
  onToggleCommandMenu: () => undefined,
  hasInput: true,
  onClearInput: () => undefined,
  onSubmit: () => undefined,
  isDragActive: false,
  queuedDraft: null,
  backgroundSendPrompt: null,
  onResolveBackgroundSendPrompt: () => undefined,
  isEditingSentMessage: false,
  onCancelEditMessage: () => undefined,
  scheduledMessages: [],
  onScheduleMessage: () => undefined,
  onCancelScheduledMessage: () => undefined,
  onEditQueuedDraft: () => undefined,
  onDeleteQueuedDraft: () => undefined,
  attachedFiles: [],
  onRemoveAttachment: () => undefined,
  fileErrors: new Map(),
  showFileDropdown: false,
  filteredFiles: [],
  selectedFileIndex: -1,
  onSelectFile: () => undefined,
  filteredCommands: [],
  selectedCommandIndex: -1,
  onCommandSelect: () => undefined,
  onCloseCommandMenu: () => undefined,
  isCommandMenuOpen: false,
  frequentCommands: [],
  getRootProps: () => ({}),
  getInputProps: () => ({}),
  openAttachmentPicker: () => undefined,
  inputHighlightRef: createRef<HTMLDivElement>() as Props['inputHighlightRef'],
  renderInputWithMentions: (text) => text,
  textareaRef: createRef<HTMLTextAreaElement>() as Props['textareaRef'],
  input: 'hello',
  onInputChange: () => undefined,
  onTextareaClick: () => undefined,
  onTextareaKeyDown: () => undefined,
  onTextareaPaste: () => undefined,
  onTextareaScrollSync: () => undefined,
  onTextareaInput: () => undefined,
  placeholder: 'Message',
  isTextareaExpanded: false,
  ...overrides,
});

const hasMenuTrigger = () => screen.queryByRole('button', { name: 'Send options' }) !== null;

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } })));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

test('idle: the plain send button, and no send menu', () => {
  render(<UiPreferencesProvider><ChatComposer {...props({})} /></UiPreferencesProvider>);

  assert.ok(screen.queryByRole('button', { name: 'Send' }) !== null, 'the send button is there');
  assert.ok(!hasMenuTrigger(), 'no menu while nothing runs');
});

test('while a turn is written the send button is the menu, and its Stop is the existing abort', () => {
  const onAbortSession = vi.fn();
  render(<UiPreferencesProvider><ChatComposer {...props({ isLoading: true, onAbortSession })} /></UiPreferencesProvider>);

  const trigger = screen.queryByRole('button', { name: 'Send options' });
  assert.ok(trigger !== null, 'the menu replaces the send button');
  assert.equal(onAbortSession.mock.calls.length, 0);

  fireEvent.click(trigger);
  const stop = Array.from(screen.getByRole('menu').querySelectorAll<HTMLElement>('[role^="menuitem"]'))
    .find((row) => (row.textContent ?? '').startsWith('Stop'));
  assert.ok(stop, 'the menu has a Stop row');
  fireEvent.click(stop);

  assert.equal(onAbortSession.mock.calls.length, 1, 'Stop calls the existing abort once');
});

test('while only background work runs the send button is the menu, ending in Send anyway', () => {
  render(<UiPreferencesProvider><ChatComposer {...props({ activity: BACKGROUND })} /></UiPreferencesProvider>);

  const trigger = screen.queryByRole('button', { name: 'Send options' });
  assert.ok(trigger !== null, 'the menu replaces the send button');
  fireEvent.click(trigger);

  const labels = Array.from(screen.getByRole('menu').querySelectorAll<HTMLElement>('[role^="menuitem"]'))
    .map((row) => row.textContent ?? '');
  assert.ok(labels.at(-1)?.startsWith('Send anyway'), `Send anyway is last, got: ${labels.join(' | ')}`);
});
