import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import '@/modules/i18n';
import PermissionRequestsBanner from '@/modules/chat/composer/PermissionRequestsBanner';
import { AskUserQuestionPanel } from '@/modules/chat/tools/InteractiveRenderers/AskUserQuestionPanel';
import type { PendingPermissionRequest } from '@/shared/types';

/**
 * OpenCode's permission requests and agent questions now reach the chat
 * (#1569). OpenCode requests carry their own "always" patterns, and its
 * question tool takes one list of picked labels per question; Claude's
 * prompts must keep working exactly as before.
 */

const renderBanner = (requests: PendingPermissionRequest[]) => {
  const handlePermissionDecision = vi.fn();
  const handleGrantToolPermission = vi.fn(() => ({ success: true }));
  render(
    <PermissionRequestsBanner
      pendingPermissionRequests={requests}
      handlePermissionDecision={handlePermissionDecision}
      handleGrantToolPermission={handleGrantToolPermission}
    />,
  );
  return { handlePermissionDecision, handleGrantToolPermission };
};

const openCodeBashRequest: PendingPermissionRequest = {
  requestId: 'per_1',
  toolName: 'bash',
  input: { command: 'printf hi', patterns: ['printf hi'] },
  context: { permission: 'bash', patterns: ['printf hi'], always: ['printf *'] },
};

const openCodeQuestions = [
  {
    question: 'Which color should the button be?',
    header: 'Color',
    options: [{ label: 'Red', description: 'Warm' }, { label: 'Blue' }],
    multiSelect: false,
    custom: true,
  },
  {
    question: 'Which sizes should ship?',
    header: 'Sizes',
    options: [{ label: 'Small' }, { label: 'Large, wide' }],
    multiSelect: true,
    custom: false,
  },
];

const openCodeQuestionRequest: PendingPermissionRequest = {
  requestId: 'que_1',
  toolName: 'question',
  input: { questions: openCodeQuestions },
  context: { kind: 'question', answerFormat: 'label-lists', agentName: 'OpenCode' },
};

describe('OpenCode permission prompts in the banner', () => {
  it('shows what "Always allow" approves and answers only that request with its patterns', () => {
    const { handlePermissionDecision, handleGrantToolPermission } = renderBanner([openCodeBashRequest]);

    expect(screen.getByText('Always allows:')).toBeTruthy();
    expect(screen.getByText('printf *')).toBeTruthy();
    expect(screen.queryByText(/Allow rule/)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Always allow' }));
    fireEvent.click(screen.getByRole('button', { name: 'Allow once' }));
    fireEvent.click(screen.getByRole('button', { name: 'Deny' }));

    expect(handlePermissionDecision.mock.calls).toEqual([
      ['per_1', { allow: true, rememberEntry: 'printf *' }],
      ['per_1', { allow: true }],
      ['per_1', { allow: false, message: 'User denied tool use' }],
    ]);
    // Nothing is written into Claude's allowed-tools settings.
    expect(handleGrantToolPermission).not.toHaveBeenCalled();
  });

  it('cannot "always allow" a request that offers no patterns', () => {
    renderBanner([{ ...openCodeBashRequest, context: { permission: 'bash', patterns: ['x'], always: [] } }]);

    expect((screen.getByRole('button', { name: 'Always allow' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('renders an OpenCode question with the question panel', () => {
    renderBanner([openCodeQuestionRequest]);

    expect(screen.getByText('OpenCode needs your input')).toBeTruthy();
    expect(screen.getByText('Which color should the button be?')).toBeTruthy();
  });

  it('keeps Claude\'s allowed-tools rule for Claude requests', () => {
    const { handlePermissionDecision, handleGrantToolPermission } = renderBanner([
      { requestId: 'claude-1', toolName: 'Bash', input: { command: 'ls -la' } },
    ]);

    expect(screen.getByText('Bash(ls:*)')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Allow & remember' }));

    expect(handleGrantToolPermission).toHaveBeenCalledWith({ entry: 'Bash(ls:*)', toolName: 'Bash' });
    expect(handlePermissionDecision).toHaveBeenCalledWith(['claude-1'], { allow: true, rememberEntry: 'Bash(ls:*)' });
  });
});

describe('the question panel', () => {
  it('answers an OpenCode question with one label list per question, in option order', () => {
    const onDecision = vi.fn();
    render(<AskUserQuestionPanel request={openCodeQuestionRequest} onDecision={onDecision} />);

    // A single-choice question: typing an answer replaces the picked option.
    fireEvent.click(screen.getByRole('button', { name: /Red/ }));
    fireEvent.click(screen.getByRole('button', { name: /Other/ }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Teal' } });
    fireEvent.click(screen.getByRole('button', { name: /Next/ }));

    // The second question accepts only its options: no "Other".
    expect(screen.queryByRole('button', { name: /Other/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Large, wide/ }));
    fireEvent.click(screen.getByRole('button', { name: /Small/ }));
    fireEvent.click(screen.getByRole('button', { name: /Submit/ }));

    expect(onDecision).toHaveBeenCalledWith('que_1', {
      allow: true,
      updatedInput: { answers: [['Teal'], ['Small', 'Large, wide']] },
    });
  });

  it('keeps a typed answer next to the picked labels', () => {
    const onDecision = vi.fn();
    render(<AskUserQuestionPanel request={{ ...openCodeQuestionRequest, input: { questions: [{ ...openCodeQuestions[0], multiSelect: true }] } }} onDecision={onDecision} />);

    fireEvent.click(screen.getByRole('button', { name: /Red/ }));
    fireEvent.click(screen.getByRole('button', { name: /Other/ }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Teal' } });
    fireEvent.click(screen.getByRole('button', { name: /Submit/ }));

    expect(onDecision).toHaveBeenCalledWith('que_1', { allow: true, updatedInput: { answers: [['Red', 'Teal']] } });
  });

  it('labels the reject of an OpenCode question "Dismiss", since it ends OpenCode\'s turn', () => {
    const onDecision = vi.fn();
    render(<AskUserQuestionPanel request={openCodeQuestionRequest} onDecision={onDecision} />);

    // "Skip" would promise that the agent carries on, as it does for Claude.
    expect(screen.queryByRole('button', { name: /Skip/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Dismiss/ }));

    expect(onDecision).toHaveBeenCalledWith('que_1', { allow: false });
  });

  it('answers Claude\'s AskUserQuestion exactly as before', () => {
    const onDecision = vi.fn();
    const input = { questions: [{ question: 'Pick one?', header: 'Pick', options: [{ label: 'A' }, { label: 'B' }] }] };
    render(<AskUserQuestionPanel request={{ requestId: 'claude-q', toolName: 'AskUserQuestion', input }} onDecision={onDecision} />);

    expect(screen.getByText('Claude needs your input')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Other/ })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /B$/ }));
    fireEvent.click(screen.getByRole('button', { name: /Submit/ }));
    fireEvent.click(screen.getByRole('button', { name: /Skip/ }));

    expect(onDecision.mock.calls).toEqual([
      ['claude-q', { allow: true, updatedInput: { ...input, answers: { 'Pick one?': 'B' } } }],
      ['claude-q', { allow: true, updatedInput: { ...input, answers: {} } }],
    ]);
  });
});
