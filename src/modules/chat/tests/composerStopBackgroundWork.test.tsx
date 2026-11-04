import assert from 'node:assert/strict';

import { fireEvent, render, screen } from '@testing-library/react';
import React, { createRef } from 'react';
import { test, vi } from 'vitest';

import '@/modules/i18n';
import ChatComposer from '@/modules/chat/composer/ChatComposer';
import { UiPreferencesProvider } from '@/shared/context/UiPreferencesContext';
import type { SessionActivity } from '@/shared/types';

/**
 * A session left running only background work is not loading, so the
 * composer's main button used to be a Send, greyed out over an empty input.
 * Until something is typed it is a Stop for that work instead.
 */

const backgroundOnly: SessionActivity = {
  statusText: null,
  canInterrupt: false,
  startedAt: Date.now(),
  background: true,
  tasks: [{ taskId: 'a1', toolUseId: 'toolu_agent', taskType: 'local_agent', description: 'Survey the fleet', startedAt: Date.now() }],
};

const noop = () => undefined;

function renderComposer(overrides: Record<string, unknown>) {
  const props: Record<string, unknown> = {
    pendingPermissionRequests: [],
    availablePermissionModes: [],
    availableEffortOptions: [],
    availableModelOptions: [],
    scheduledMessages: [],
    attachedFiles: [],
    fileErrors: new Map(),
    filteredFiles: [],
    filteredCommands: [],
    frequentCommands: [],
    activity: null,
    isLoading: false,
    permissionMode: 'default',
    providerLabel: 'Claude',
    effort: '',
    model: 'test-model',
    modelsLoading: false,
    tokenBudget: null,
    slashCommandsCount: 0,
    hasInput: false,
    isDragActive: false,
    queuedDraft: null,
    backgroundSendPrompt: null,
    isEditingSentMessage: false,
    showFileDropdown: false,
    selectedFileIndex: 0,
    selectedCommandIndex: 0,
    isCommandMenuOpen: false,
    getRootProps: () => ({}),
    getInputProps: () => ({}),
    inputHighlightRef: createRef(),
    textareaRef: createRef(),
    renderInputWithMentions: (text: string) => text,
    input: '',
    placeholder: '',
    isTextareaExpanded: false,
    ...overrides,
  };
  const withNoops = new Proxy(props, { get: (target, key) => (key in target ? target[key as string] : noop) });
  return render(<UiPreferencesProvider><ChatComposer {...(withNoops as unknown as React.ComponentProps<typeof ChatComposer>)} /></UiPreferencesProvider>);
}

const sendButton = () => screen.getByRole('button', { name: 'Send' });

test('with only background work and nothing typed, the main button stops that work', () => {
  const onStopBackgroundWork = vi.fn();
  const onSubmit = vi.fn();
  const { container } = renderComposer({ activity: backgroundOnly, onStopBackgroundWork, onSubmit });

  const button = screen.getAllByRole('button', { name: 'Stop' }).find((element) => container.querySelector('form')?.contains(element));
  assert.ok(button, 'the main button reads Stop');
  assert.equal(button.hasAttribute('disabled'), false);
  fireEvent.click(button);
  assert.equal(onStopBackgroundWork.mock.calls.length, 1);
  assert.equal(onSubmit.mock.calls.length, 0);
});

test('once something is typed over background work, the main button is Send again', () => {
  const onStopBackgroundWork = vi.fn();
  const { container } = renderComposer({ activity: backgroundOnly, onStopBackgroundWork, input: 'next step', hasInput: true });

  const formStop = screen.queryAllByRole('button', { name: 'Stop' }).filter((element) => container.querySelector('form')?.contains(element));
  assert.equal(formStop.length, 0);
  assert.equal(sendButton().hasAttribute('disabled'), false);
});

test('an idle session with nothing typed keeps a disabled Send', () => {
  const { container } = renderComposer({});

  const formStop = screen.queryAllByRole('button', { name: 'Stop' }).filter((element) => container.querySelector('form')?.contains(element));
  assert.equal(formStop.length, 0);
  assert.equal(sendButton().hasAttribute('disabled'), true);
});
