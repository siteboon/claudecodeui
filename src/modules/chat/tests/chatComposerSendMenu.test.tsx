import assert from 'node:assert/strict';

import { createRef } from 'react';
import type { ComponentProps } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, test, vi } from 'vitest';

import '@/modules/i18n';
import ChatComposer from '@/modules/chat/composer/ChatComposer';
import { UiPreferencesProvider } from '@/shared/context/UiPreferencesContext';
import type { SessionActivity } from '@/shared/types';
import * as useVoiceInputModule from '@/modules/chat/hooks/useVoiceInput';

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

test('turn running, composer empty: the green submit button is Stop, one tap aborts, and no menu opens', () => {
  const onAbortSession = vi.fn();
  render(<UiPreferencesProvider><ChatComposer {...props({ isLoading: true, onAbortSession, input: '', hasInput: false, attachedFiles: [] })} /></UiPreferencesProvider>);

  assert.ok(!hasMenuTrigger(), 'an empty composer keeps the plain button, not the menu');
  const stop = screen.getByRole('button', { name: 'Stop' });
  assert.equal(onAbortSession.mock.calls.length, 0);

  fireEvent.click(stop);

  assert.equal(onAbortSession.mock.calls.length, 1, 'one tap aborts the turn');
});

test('background work, composer empty: the submit button is disabled', () => {
  render(<UiPreferencesProvider><ChatComposer {...props({ activity: BACKGROUND, input: '', hasInput: false, attachedFiles: [] })} /></UiPreferencesProvider>);

  assert.ok(!hasMenuTrigger(), 'an empty composer keeps the plain button, not the menu');
  const submit = screen.getByRole('button', { name: 'Send' });
  assert.ok((submit as HTMLButtonElement).disabled, 'disabled with nothing to send');
});

test('turn running, transcribing: the plain submit button is disabled, so a tap cannot abort the turn', () => {
  // Transcribing draws the same spinner as a running turn, but it is not a
  // turn: a tap on the spinner must not reach `onAbortSession`, which the
  // `isLoading` branch below would otherwise wire up.
  const onAbortSession = vi.fn();
  const spy = vi.spyOn(useVoiceInputModule, 'useVoiceInput').mockReturnValue({
    state: 'transcribing',
    toggle: () => undefined,
    stop: () => undefined,
  });

  render(<UiPreferencesProvider><ChatComposer {...props({ isLoading: true, onAbortSession })} /></UiPreferencesProvider>);

  assert.ok(!hasMenuTrigger(), 'transcribing keeps the plain button, not the menu');
  const submit = screen.getByRole('button', { name: 'Send' });
  assert.ok((submit as HTMLButtonElement).disabled, 'disabled while transcribing, even though a turn is running');

  fireEvent.click(submit);
  assert.equal(onAbortSession.mock.calls.length, 0, 'a tap on the disabled spinner cannot end the turn');

  spy.mockRestore();
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

test('turn running, input present: the menu offers Queue, Side question, Stop in that order', () => {
  render(<UiPreferencesProvider><ChatComposer {...props({ isLoading: true, supportsSideQuestions: true })} /></UiPreferencesProvider>);

  const trigger = screen.getByRole('button', { name: 'Send options' });
  fireEvent.click(trigger);

  const labels = Array.from(screen.getByRole('menu').querySelectorAll<HTMLElement>('[role^="menuitem"]'))
    .map((row) => row.textContent ?? '');
  assert.equal(labels.length, 3, `Queue, Side question, Stop, got: ${labels.join(' | ')}`);
  assert.ok(labels[0]?.startsWith('Queue'), `first row is Queue, got: ${labels.join(' | ')}`);
  assert.ok(labels[1]?.startsWith('Side question'), `second row is Side question, got: ${labels.join(' | ')}`);
  assert.ok(labels[2]?.startsWith('Stop'), `third row is Stop, got: ${labels.join(' | ')}`);
});

test('the side-question shortcut hint shows for a fine pointer with hover, not by screen width', () => {
  // A landscape phone is wide enough for `sm:`, but has neither hover nor a
  // fine pointer, so the hint must gate on `(hover: hover) and (pointer: fine)`
  // rather than a breakpoint.
  render(<UiPreferencesProvider><ChatComposer {...props({ isLoading: true, supportsSideQuestions: true })} /></UiPreferencesProvider>);
  fireEvent.click(screen.getByRole('button', { name: 'Send options' }));

  const hint = screen.getByText(/⌥↵|Alt\+↵/);
  assert.ok(
    hint.className.includes('[@media(hover:hover)_and_(pointer:fine)]:inline-block'),
    `expected the hover/fine-pointer gate, got: ${hint.className}`,
  );
  assert.ok(!hint.className.includes('sm:inline-block'), `expected no width-based gate, got: ${hint.className}`);
});

test('background work, input present: the menu offers Queue, Side question, Send anyway in that order', () => {
  render(<UiPreferencesProvider><ChatComposer {...props({ activity: BACKGROUND, supportsSideQuestions: true })} /></UiPreferencesProvider>);

  const trigger = screen.getByRole('button', { name: 'Send options' });
  fireEvent.click(trigger);

  const labels = Array.from(screen.getByRole('menu').querySelectorAll<HTMLElement>('[role^="menuitem"]'))
    .map((row) => row.textContent ?? '');
  assert.equal(labels.length, 3, `Queue, Side question, Send anyway, got: ${labels.join(' | ')}`);
  assert.ok(labels[0]?.startsWith('Queue'), `first row is Queue, got: ${labels.join(' | ')}`);
  assert.ok(labels[1]?.startsWith('Side question'), `second row is Side question, got: ${labels.join(' | ')}`);
  assert.ok(labels[2]?.startsWith('Send anyway'), `third row is Send anyway, got: ${labels.join(' | ')}`);
});

// The capability gate has to travel: every component defaults
// `supportsSideQuestions` to false, so a composer that never hands the flag on
// would silently drop side questions for every provider. These pin that
// `ChatComposer` passes it to its send menu and its background-send dialog.
const PROMPT = { work: ['Agent Survey the repo'] };

const menuLabels = () => Array.from(screen.getByRole('menu').querySelectorAll<HTMLElement>('[role^="menuitem"]'))
  .map((row) => row.textContent ?? '');

for (const [state, overrides] of [
  ['while a turn is written', { isLoading: true }],
  ['while only background work runs', { activity: BACKGROUND }],
] as const) {
  test(`${state}, supportsSideQuestions true reaches the menu as a side-question row`, () => {
    render(<UiPreferencesProvider><ChatComposer {...props({ ...overrides, supportsSideQuestions: true })} /></UiPreferencesProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'Send options' }));

    assert.ok(menuLabels().some((label) => label.startsWith('Side question')), `got: ${menuLabels().join(' | ')}`);
  });

  test(`${state}, supportsSideQuestions false leaves the side-question row out of the menu`, () => {
    render(<UiPreferencesProvider><ChatComposer {...props({ ...overrides, supportsSideQuestions: false })} /></UiPreferencesProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'Send options' }));

    assert.equal(menuLabels().length, 2, `only the two session choices, got: ${menuLabels().join(' | ')}`);
    assert.ok(!menuLabels().some((label) => label.startsWith('Side question')));
  });
}

test('supportsSideQuestions true reaches the background-send dialog as a side-question button', () => {
  render(<UiPreferencesProvider><ChatComposer {...props({ activity: BACKGROUND, backgroundSendPrompt: PROMPT, supportsSideQuestions: true })} /></UiPreferencesProvider>);

  assert.ok(screen.queryByRole('button', { name: 'Side question' }) !== null, 'the dialog offers the side question');
});

test('supportsSideQuestions false leaves the side-question button out of the background-send dialog', () => {
  render(<UiPreferencesProvider><ChatComposer {...props({ activity: BACKGROUND, backgroundSendPrompt: PROMPT, supportsSideQuestions: false })} /></UiPreferencesProvider>);

  const names = Array.from(screen.getByRole('dialog').querySelectorAll('button'))
    .map((button) => button.textContent?.trim() ?? '')
    .filter((name) => name !== '');
  assert.deepEqual(names, ['Cancel', 'Queue', 'Send anyway']);
});
