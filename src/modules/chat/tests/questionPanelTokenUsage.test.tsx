import assert from 'node:assert/strict';

import { createRef } from 'react';
import type { ComponentProps } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, test, vi } from 'vitest';

import '@/modules/i18n';
import ChatComposer from '@/modules/chat/composer/ChatComposer';
import { UiPreferencesProvider } from '@/shared/context/UiPreferencesContext';

/**
 * A question from the agent replaces the input box, which is where the token
 * usage normally sits. The answer often depends on how much context is left,
 * so the usage button must stay on screen, and still open the breakdown, while
 * the question panel is up.
 *
 * Every prop below is a stub of the composer's current interface; only
 * `pendingPermissionRequests`, `tokenBudget` and `onShowTokenUsage` matter here.
 */

type Props = ComponentProps<typeof ChatComposer>;

const QUESTION_REQUEST = {
  requestId: 'question-1',
  toolName: 'AskUserQuestion',
  input: {
    questions: [
      {
        question: 'Which way should we go?',
        header: 'Approach',
        multiSelect: false,
        options: [
          { label: 'Left', description: 'Go left' },
          { label: 'Right', description: 'Go right' },
        ],
      },
    ],
  },
} as Props['pendingPermissionRequests'][number];

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
  tokenBudget: { used: 42_000 },
  onShowTokenUsage: () => undefined,
  slashCommandsCount: 0,
  onToggleCommandMenu: () => undefined,
  hasInput: false,
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
  input: '',
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

const tokenUsageButtons = () => screen.queryAllByRole('button', { name: 'Show token usage' });

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } })));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

test('no question pending: the token usage sits in the input box, once', () => {
  render(<UiPreferencesProvider><ChatComposer {...props({})} /></UiPreferencesProvider>);

  assert.ok(screen.queryByPlaceholderText('Message') !== null, 'the input is there');
  assert.equal(tokenUsageButtons().length, 1);
});

test('question pending: the input is gone but the token usage stays and opens the breakdown', () => {
  const onShowTokenUsage = vi.fn();
  render(
    <UiPreferencesProvider>
      <ChatComposer {...props({ pendingPermissionRequests: [QUESTION_REQUEST], onShowTokenUsage })} />
    </UiPreferencesProvider>,
  );

  assert.ok(screen.queryByText('Which way should we go?') !== null, 'the question panel is shown');
  assert.equal(screen.queryByPlaceholderText('Message'), null, 'the input is replaced by the question');
  const buttons = tokenUsageButtons();
  assert.equal(buttons.length, 1, 'token usage is still on screen, once');
  assert.ok(buttons[0].textContent?.includes('42K'), 'it shows the used tokens');

  fireEvent.click(buttons[0]);

  assert.equal(onShowTokenUsage.mock.calls.length, 1, 'clicking it opens the token breakdown');
});
