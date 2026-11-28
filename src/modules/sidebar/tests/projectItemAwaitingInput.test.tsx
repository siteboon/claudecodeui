import assert from 'node:assert/strict';

import { act, render, screen } from '@testing-library/react';
import type { TFunction } from 'i18next';
import { test, vi } from 'vitest';

import type { Project, ServerEvent, SessionWithProvider } from '@/shared/types';

/**
 * When a project folder is collapsed in the Projects tab, its session rows are
 * hidden. The folder header still surfaces the awaiting-answer badge so the user
 * can tell which project contains the blocked conversation without opening every
 * folder.
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

vi.mock('@/modules/sidebar/SidebarProjectSessions', () => ({
  default: () => null,
}));

const { PermissionAttentionProvider } = await import('@/shared/context/PermissionAttentionContext');
const { default: SidebarProjectItem } = await import('@/modules/sidebar/SidebarProjectItem');

const t = ((key: string, options?: string | { defaultValue?: string }) =>
  typeof options === 'string' ? options : options?.defaultValue ?? key) as unknown as TFunction;

const project: Project = {
  projectId: 'p1',
  name: 'project-one',
  displayName: 'Project One',
  fullPath: '/workspace/project-one',
  sessionMeta: { total: 1, hasMore: false },
};

const sessions: SessionWithProvider[] = [
  { id: 's1', summary: 'Blocked session', __provider: 'claude' },
];

const noop = () => {};

const renderProject = (isExpanded: boolean) => render(
  <PermissionAttentionProvider>
    <SidebarProjectItem
      project={project}
      selectedProject={null}
      selectedSession={null}
      isExpanded={isExpanded}
      isDeleting={false}
      isStarred={false}
      isEditing={false}
      renameDraft=""
      sessions={sessions}
      initialSessionsLoaded
      isLoadingMoreSessions={false}
      currentTime={new Date('2026-11-27T10:00:00.000Z')}
      sessionRenameId={null}
      sessionRenameDraft=""
      tasksEnabled={false}
      mcpServerStatus={{ hasMCPServer: false, isConfigured: false }}
      onRenameDraftChange={noop}
      onToggleProject={noop}
      onProjectSelect={noop}
      onToggleStarProject={noop}
      onStartEditingProject={noop}
      onCancelEditingProject={noop}
      onSaveProjectName={noop}
      onDeleteProject={noop}
      onSessionSelect={noop}
      onArchiveSession={noop}
      onDeleteSession={noop}
      onLoadMoreSessions={noop}
      activeSessions={new Set()}
      backgroundSessionIds={new Set()}
      attentionSessionIds={new Set()}
      onNewSession={noop}
      onStartEditingSession={noop}
      onCancelEditingSession={noop}
      onSaveEditingSession={noop}
      selectedSessionIds={null}
      onSetSessionSelection={noop}
      onToggleSessionSelected={noop}
      onCancelSessionSelection={noop}
      onDeleteSelectedSessions={noop}
      t={t}
    />
  </PermissionAttentionProvider>,
);

const send = (event: Record<string, unknown>) => {
  act(() => {
    emit?.(event as ServerEvent);
  });
};

test('a collapsed project shows the awaiting-answer badge while a session inside it is blocked', () => {
  renderProject(false);
  assert.equal(screen.queryByText('Awaiting answer'), null);

  send({ kind: 'permission_attention', sessionId: 's1', requestId: 'r1', toolName: 'AskUserQuestion' });
  assert.ok(screen.getByText('Awaiting answer'));

  send({ kind: 'permission_attention_cleared', sessionId: 's1', requestId: 'r1' });
  assert.equal(screen.queryByText('Awaiting answer'), null);
});

test('an expanded project leaves the awaiting-answer badge to its session row', () => {
  renderProject(true);

  send({ kind: 'permission_attention', sessionId: 's1', requestId: 'r1', toolName: 'AskUserQuestion' });

  assert.equal(screen.queryByText('Awaiting answer'), null);
});
