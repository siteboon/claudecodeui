import assert from 'node:assert/strict';

import { render, fireEvent } from '@testing-library/react';
import React from 'react';
import { test, vi } from 'vitest';

import { getLatestOpenableSession } from '@/modules/sidebar/utils/sidebarProjectFormatting';
import type { Project } from '@/shared/types';

/**
 * Clicking a project row used to select the project and nothing else, which
 * left the pane on a blank new session: a project with twenty conversations in
 * it opened onto none of them. The row now means "open what I was last in", and
 * a new session stays one click away inside the folder.
 */

const project = (sessions: Array<Record<string, unknown>>): Project => ({
  projectId: 'p1',
  displayName: 'claudecodeui',
  fullPath: '/home/valeriu/work/claudecodeui',
  sessions,
} as unknown as Project);

test('picks the most recent session', () => {
  const latest = getLatestOpenableSession(project([
    { id: 'older', lastActivity: '2026-09-17T10:00:00.000Z' },
    { id: 'newest', lastActivity: '2026-09-18T10:00:00.000Z' },
  ]));

  assert.equal(latest?.id, 'newest');
});

test('skips archived sessions, however recent', () => {
  // Archived rows have their own view; landing on one by clicking a folder
  // would be a surprise, not a shortcut.
  const latest = getLatestOpenableSession(project([
    { id: 'archived', lastActivity: '2026-09-18T12:00:00.000Z', isArchived: true },
    { id: 'live', lastActivity: '2026-09-18T10:00:00.000Z' },
  ]));

  assert.equal(latest?.id, 'live');
});

test('has nothing to open in an empty project', () => {
  // The old behaviour is still the right one here: a project with no sessions
  // opens a new one.
  assert.equal(getLatestOpenableSession(project([])), null);
  assert.equal(getLatestOpenableSession(project([{ id: 'a', isArchived: true }])), null);
});

/**
 * The other half: the project row has to call the handler that opens a session,
 * not the one that only selects a project. They are separate because the
 * search-result path selects a project on its way to a specific session.
 */
test('a click on the project row asks to open the project, not merely select it', async () => {
  const { default: SidebarProjectItem } = await import('@/modules/sidebar/SidebarProjectItem');
  const onProjectOpen = vi.fn();
  const onProjectSelect = vi.fn();
  const noop = () => {};

  const { getByText } = render(
    <SidebarProjectItem
      project={project([{ id: 'newest' }])}
      selectedProject={null}
      selectedSession={null}
      isExpanded={false}
      isDeleting={false}
      isStarred={false}
      isEditing={false}
      renameDraft=""
      sessions={[]}
      initialSessionsLoaded
      isLoadingMoreSessions={false}
      currentTime={new Date()}
      sessionRenameId={null}
      sessionRenameDraft=""
      tasksEnabled={false}
      mcpServerStatus={{} as never}
      activeSessions={new Set<string>()}
      attentionSessionIds={new Set<string>()}
      onRenameDraftChange={noop}
      onToggleProject={noop}
      onProjectSelect={onProjectSelect}
      onProjectOpen={onProjectOpen}
      onToggleStarProject={noop}
      onStartEditingProject={noop}
      onCancelEditingProject={noop}
      onSaveProjectName={noop}
      onDeleteProject={noop}
      onSessionSelect={noop}
      onDeleteSession={noop}
      onLoadMoreSessions={noop}
      onNewSession={noop}
      onStartEditingSession={noop}
      onCancelEditingSession={noop}
      onSaveEditingSession={noop}
      t={((key: string) => key) as never}
    />,
  );

  fireEvent.click(getByText('claudecodeui'));

  assert.equal(onProjectOpen.mock.calls.length, 1);
  assert.equal(onProjectSelect.mock.calls.length, 0);
});
