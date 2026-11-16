import assert from 'node:assert/strict';

import { fireEvent, render, screen } from '@testing-library/react';
import { test, vi } from 'vitest';

import '@/modules/i18n';
import { DesktopWrapUpCard, findDesktopWrapUp } from '@/modules/chat/transcript/DesktopWrapUpCard';
import type { ChatMessage } from '@/shared/types';

const wrapUp: ChatMessage = {
  type: 'tool',
  timestamp: 1,
  isToolUse: true,
  toolName: 'mcp__ccd_turn__wrap_up',
  toolInput: JSON.stringify({
    recap: 'The draft is ready for review.',
    ask: 'What should we do next?',
    actions: [
      { label: 'Review the draft', hiddenPrompt: 'Never copy this field' },
      { label: 'Discuss the outline' },
      { label: 'Review the draft' },
      { label: 123 },
    ],
  }),
};

test('reads a successful wrap-up from the current turn, ignoring side questions', () => {
  const reply: ChatMessage = { type: 'assistant', content: 'The draft is ready.', timestamp: 2 };
  const sideQuestion: ChatMessage = {
    type: 'user', content: 'What is a draft?', timestamp: 2,
    sideQuestion: { sideQuestionId: 'aside', sessionId: 'chat', status: 'done' },
  };
  assert.deepEqual(findDesktopWrapUp([wrapUp, reply, sideQuestion])?.actions, [
    'Review the draft', 'Discuss the outline',
  ]);
  assert.equal(findDesktopWrapUp([wrapUp, reply, { type: 'user', timestamp: 3 }]), null);
  assert.equal(findDesktopWrapUp([{ ...wrapUp, toolInput: '{' }]), null);
  assert.equal(findDesktopWrapUp([{ ...wrapUp, toolResult: { content: 'Failed', isError: true } }]), null);
});

test('shows the recorded recap and inserts only the selected label', () => {
  const card = findDesktopWrapUp([wrapUp]);
  assert(card);
  const choose = vi.fn();
  render(<DesktopWrapUpCard {...card} onChoose={choose} />);

  assert(screen.getByText('The draft is ready for review.'));
  assert(screen.getByText('What should we do next?'));
  assert.equal(choose.mock.calls.length, 0);
  fireEvent.click(screen.getByRole('button', { name: 'Review the draft' }));
  assert.deepEqual(choose.mock.calls, [['Review the draft']]);
  assert.equal(screen.queryByText('What should we do next?'), null);
});
