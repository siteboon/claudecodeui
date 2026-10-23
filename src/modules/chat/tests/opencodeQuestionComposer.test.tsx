import { createRef, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import '@/modules/i18n';
import ChatComposer from '@/modules/chat/composer/ChatComposer';
import type { PendingPermissionRequest } from '@/shared/types';

/**
 * While an agent's question is shown, its panel replaces the composer: text
 * typed into the composer then would be queued as the next message instead of
 * answering the question. That held for Claude's AskUserQuestion; OpenCode's
 * question tool (#1569) must behave the same, and the composer has to come
 * back once the question is answered or dismissed.
 */

// Voice input needs the UI preferences provider and a voice backend; neither
// has anything to do with the question panel.
vi.mock('@/modules/chat/hooks/useVoiceAvailable', () => ({ useVoiceAvailable: () => false }));
vi.mock('@/modules/chat/hooks/useVoiceInput', () => ({
  useVoiceInput: () => ({ state: 'idle', toggle: () => undefined, stop: () => undefined }),
}));

const COMPOSER_PLACEHOLDER = 'Message the agent';

const openCodeQuestionRequest: PendingPermissionRequest = {
  requestId: 'que_1',
  toolName: 'question',
  input: {
    questions: [{
      question: 'Which color should the button be?',
      header: 'Color',
      options: [{ label: 'Red' }, { label: 'Blue' }],
      multiSelect: false,
      custom: true,
    }],
  },
  context: { kind: 'question', answerFormat: 'label-lists', agentName: 'OpenCode' },
};

const openCodeBashRequest: PendingPermissionRequest = {
  requestId: 'per_1',
  toolName: 'bash',
  input: { command: 'printf hi', patterns: ['printf hi'] },
  context: { permission: 'bash', patterns: ['printf hi'], always: ['printf *'] },
};

const noop = () => undefined;

/**
 * The composer with the pending requests held the way useChatComposerState
 * holds them: a decision drops the answered request from the list.
 */
function ComposerWithPrompts({ initialRequests, onDecision }: {
  initialRequests: PendingPermissionRequest[];
  onDecision: (requestIds: string | string[], decision: unknown) => void;
}) {
  // The open prompts; answering one removes it, as in the chat.
  const [pending, setPending] = useState(initialRequests);
  return (
    <ChatComposer
      pendingPermissionRequests={pending}
      handlePermissionDecision={(requestIds, decision) => {
        onDecision(requestIds, decision);
        const ids = Array.isArray(requestIds) ? requestIds : [requestIds];
        setPending((previous) => previous.filter((request) => !ids.includes(request.requestId)));
      }}
      handleGrantToolPermission={() => ({ success: true })}
      activity={null}
      isLoading
      onAbortSession={noop}
      permissionMode="default"
      availablePermissionModes={['default']}
      onSelectPermissionMode={noop}
      providerLabel="OpenCode"
      effort=""
      availableEffortOptions={[]}
      onSelectEffort={noop}
      model="fake/fake-model"
      availableModelOptions={[]}
      onSelectModel={noop}
      modelsLoading={false}
      tokenBudget={null}
      onShowTokenUsage={noop}
      slashCommandsCount={0}
      onToggleCommandMenu={noop}
      hasInput={false}
      onClearInput={noop}
      onSubmit={noop}
      isDragActive={false}
      queuedDraft={null}
      backgroundSendPrompt={null}
      onResolveBackgroundSendPrompt={noop}
      isEditingSentMessage={false}
      onCancelEditMessage={noop}
      scheduledMessages={[]}
      onScheduleMessage={noop}
      onCancelScheduledMessage={noop}
      onEditQueuedDraft={noop}
      onDeleteQueuedDraft={noop}
      attachedFiles={[]}
      onRemoveAttachment={noop}
      fileErrors={new Map()}
      showFileDropdown={false}
      filteredFiles={[]}
      selectedFileIndex={-1}
      onSelectFile={noop}
      filteredCommands={[]}
      selectedCommandIndex={-1}
      onCommandSelect={noop}
      onCloseCommandMenu={noop}
      isCommandMenuOpen={false}
      frequentCommands={[]}
      getRootProps={() => ({})}
      getInputProps={() => ({})}
      openAttachmentPicker={noop}
      inputHighlightRef={createRef<HTMLDivElement>()}
      renderInputWithMentions={(text) => text}
      textareaRef={createRef<HTMLTextAreaElement>()}
      input=""
      onInputChange={noop}
      onTextareaClick={noop}
      onTextareaKeyDown={noop}
      onTextareaPaste={noop}
      onTextareaScrollSync={noop}
      onTextareaInput={noop}
      placeholder={COMPOSER_PLACEHOLDER}
      isTextareaExpanded={false}
    />
  );
}

const composerInput = () => screen.queryByPlaceholderText(COMPOSER_PLACEHOLDER);

afterEach(cleanup);

describe('the composer while OpenCode asks a question', () => {
  it('is hidden while the question is shown and comes back once it is answered', () => {
    const onDecision = vi.fn();
    render(<ComposerWithPrompts initialRequests={[openCodeQuestionRequest]} onDecision={onDecision} />);

    expect(screen.getByText('OpenCode needs your input')).toBeTruthy();
    expect(composerInput()).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /Blue/ }));
    fireEvent.click(screen.getByRole('button', { name: /Submit/ }));

    expect(onDecision).toHaveBeenCalledWith('que_1', { allow: true, updatedInput: { answers: [['Blue']] } });
    expect(screen.queryByText('OpenCode needs your input')).toBeNull();
    expect(composerInput()).toBeTruthy();
  });

  it('comes back once the question is dismissed', () => {
    const onDecision = vi.fn();
    render(<ComposerWithPrompts initialRequests={[openCodeQuestionRequest]} onDecision={onDecision} />);
    expect(composerInput()).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /Dismiss/ }));

    expect(onDecision).toHaveBeenCalledWith('que_1', { allow: false });
    expect(composerInput()).toBeTruthy();
  });

  it('stays visible next to an OpenCode permission prompt', () => {
    render(<ComposerWithPrompts initialRequests={[openCodeBashRequest]} onDecision={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'Allow once' })).toBeTruthy();
    expect(composerInput()).toBeTruthy();
  });
});
