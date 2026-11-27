import assert from 'node:assert/strict';

import { fireEvent, render, screen } from '@testing-library/react';
import { test, vi } from 'vitest';

import '@/modules/i18n';
import MessageComponent from '@/modules/chat/transcript/MessageComponent';
import { UiPreferencesProvider } from '@/shared/context/UiPreferencesContext';
import type { ChatMessage } from '@/shared/types';

test('AGY persisted prompts expose the common pencil and fork actions with the native anchor', () => {
  const message: ChatMessage = {
    id: 'app-14', type: 'user', content: 'Original prompt', transcriptAnchorId: '14',
    timestamp: '2026-11-12T00:00:00.000Z',
  };
  const edit = vi.fn();
  const fork = vi.fn();
  render(<UiPreferencesProvider>
    <MessageComponent message={message} prevMessage={null} createDiff={() => []} provider="antigravity"
      onEditMessage={edit} onForkFromMessage={fork} />
  </UiPreferencesProvider>);
  fireEvent.click(screen.getByRole('button', { name: /edit.*resend/i }));
  fireEvent.click(screen.getByRole('button', { name: /fork.*here/i }));
  assert.equal(edit.mock.calls[0][0].transcriptAnchorId, '14');
  assert.equal(fork.mock.calls[0][0].transcriptAnchorId, '14');
});
