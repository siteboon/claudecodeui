import assert from 'node:assert/strict';

import { act, render, screen } from '@testing-library/react';
import { test, vi } from 'vitest';

import type { RecentConversationListItem, ServerEvent, SessionRowActions, SidebarProjectListProps } from '@/shared/types';

/**
 * The Conversations list has to say which row is blocked, not merely that some
 * session is: a run waiting on an answer is stopped until the user acts. The
 * row keeps the marker even while it is open, because the turn is blocked then
 * too; unrelated rows must be left alone.
 */

let emit: ((event: ServerEvent) => void) | null = null;

vi.mock('@/shared/context/WebSocketContext', () => ({
  useWebSocket: () => ({
    subscribe: (handler: (event: ServerEvent) => void) => {
      emit = handler;
      return () => {
        emit = null;
      };
    },
  }),
}));

vi.mock('@/modules/sidebar/SessionOptions', () => ({
  default: () => null,
}));

const { PermissionAttentionProvider } = await import('@/shared/context/PermissionAttentionContext');
const { default: SidebarRecentConversations } = await import('@/modules/sidebar/SidebarRecentConversations');

const t = ((key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key) as unknown as SidebarProjectListProps['t'];

const conversation = (sessionId: string): RecentConversationListItem => ({
  sessionId,
  provider: 'claude',
  projectId: 'project-1',
  projectDisplayName: 'project one',
  sessionTitle: `title of ${sessionId}`,
  lastActivity: '2026-08-21T09:30:00.000Z',
});

const sessionActions: SessionRowActions = {
  activeRename: null,
  activeSessions: new Set<string>(),
  backgroundSessionIds: new Set<string>(),
  attentionSessionIds: new Set<string>(),
  onRenameDraftChange: () => {},
  onStartEditingSession: () => {},
  onCancelEditingSession: () => {},
  onSaveEditingSession: () => {},
  onArchiveSession: () => {},
  onDeleteSession: () => {},
};

const mount = () => render(
  <PermissionAttentionProvider>
    <SidebarRecentConversations
      conversations={[conversation('s1'), conversation('s2')]}
      total={2}
      hasMore={false}
      isLoading={false}
      isLoadingMore={false}
      hasError={false}
      selectedSession={null}
      currentTime={new Date('2026-08-21T10:00:00.000Z')}
      sessionActions={sessionActions}
      onConversationSelect={() => {}}
      onLoadMore={() => {}}
      onRetry={() => {}}
      t={t}
    />
  </PermissionAttentionProvider>,
);

const send = (event: Record<string, unknown>) => {
  act(() => {
    emit?.(event as ServerEvent);
  });
};

const rowTextFor = (title: string): string => (
  screen.getAllByTestId('recent-conversation-row')
    .find((row) => row.textContent?.includes(title))?.textContent ?? ''
);

test('the blocked row says it is waiting, and only that row', () => {
  mount();
  assert.equal(rowTextFor('title of s1').includes('Awaiting answer'), false);

  send({ kind: 'permission_attention', sessionId: 's1', requestId: 'r1', toolName: 'AskUserQuestion' });

  assert.equal(rowTextFor('title of s1').includes('Awaiting answer'), true);
  assert.equal(rowTextFor('title of s2').includes('Awaiting answer'), false);
});

test('answering the question drops the row marker', () => {
  mount();
  send({ kind: 'permission_attention', sessionId: 's1', requestId: 'r1' });
  assert.equal(rowTextFor('title of s1').includes('Awaiting answer'), true);

  send({ kind: 'permission_attention_cleared', sessionId: 's1', requestId: 'r1' });

  assert.equal(rowTextFor('title of s1').includes('Awaiting answer'), false);
});
