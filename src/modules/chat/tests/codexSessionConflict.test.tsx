import { render } from '@testing-library/react';
import { expect, test } from 'vitest';

import MessageComponent from '@/modules/chat/transcript/MessageComponent';
import type { ChatMessage } from '@/shared/types';

const conflict = 'Codex Exec exited with code 1: Reading prompt from stdin...\nERROR failed to initialize thread persistence: thread-store conflict: thread test-thread already has an active writer';

test('web chat explains writer conflicts and retains the raw error in collapsed details', () => {
  const { container, getByRole } = render(
    <MessageComponent message={{ type: 'error', content: conflict, timestamp: new Date().toISOString() }}
      prevMessage={null} createDiff={() => []} provider="codex" />,
  );
  expect(getByRole('alert').textContent).toContain('A completed reply does not close');
  expect(getByRole('alert').textContent).toContain('End terminal');
  const details = container.querySelector('details');
  expect(details?.open).toBe(false);
  expect(details?.textContent).toContain(conflict);
});

test('unrelated errors and quoted error text in user messages are not treated as conflicts', () => {
  for (const [provider, type, content] of [
    ['claude', 'error', conflict],
    ['codex', 'user', conflict],
    ['codex', 'error', 'Network unavailable'],
  ] as const) {
    const message: ChatMessage = { type, content, timestamp: new Date().toISOString() };
    const { queryByRole, unmount } = render(
      <MessageComponent message={message} prevMessage={null} createDiff={() => []} provider={provider} />,
    );
    expect(queryByRole('alert')).toBeNull();
    unmount();
  }
});
