import assert from 'node:assert/strict';

import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { test, vi } from 'vitest';

import type { Project } from '@/shared/types';

/**
 * A project folder renamed outside the app leaves every chat attached to a path
 * that no longer exists (issue #1165). The row's editor is where that is
 * repaired, so it has to expose the folder and hand it to the save callback.
 */

vi.mock('@/modules/sidebar/SidebarProjectSessions', () => ({
  default: () => null,
}));

vi.mock('@/modules/sidebar/hooks/useCompactSidebar', () => ({
  useCompactSidebar: () => false,
}));

const { default: SidebarProjectItem } = await import('@/modules/sidebar/SidebarProjectItem');

const PROJECT = {
  projectId: 'a',
  name: 'a',
  displayName: 'alpha',
  fullPath: '/workspace/alpha',
  sessions: [],
} as unknown as Project;

const noop = () => {};
const t = ((key: string) => key) as unknown as Parameters<typeof SidebarProjectItem>[0]['t'];

type ItemProps = Parameters<typeof SidebarProjectItem>[0];

const itemProps = (overrides: Partial<ItemProps>): ItemProps => ({
  project: PROJECT,
  selectedProject: null,
  selectedSession: null,
  isExpanded: false,
  isDeleting: false,
  isStarred: false,
  isEditing: true,
  renameDraft: 'alpha',
  renamePathDraft: PROJECT.fullPath,
  sessions: [],
  initialSessionsLoaded: true,
  isLoadingMoreSessions: false,
  currentTime: new Date('2026-08-21T10:00:00.000Z'),
  sessionRenameId: null,
  sessionRenameDraft: '',
  tasksEnabled: false,
  mcpServerStatus: null,
  onRenameDraftChange: noop,
  onRenamePathDraftChange: noop,
  onToggleProject: noop,
  onProjectSelect: noop,
  onToggleStarProject: noop,
  onStartEditingProject: noop,
  onCancelEditingProject: noop,
  onSaveProjectName: noop,
  onDeleteProject: noop,
  onSessionSelect: noop,
  onDeleteSession: noop,
  onLoadMoreSessions: noop,
  activeSessions: new Set<string>(),
  backgroundSessionIds: new Set<string>(),
  attentionSessionIds: new Set<string>(),
  onNewSession: noop,
  onStartEditingSession: noop,
  onCancelEditingSession: noop,
  onSaveEditingSession: noop,
  t,
  ...overrides,
}) as ItemProps;

test('the project editor exposes the folder the project points at', () => {
  render(React.createElement(SidebarProjectItem, itemProps({})));

  const folderInputs = screen
    .getAllByPlaceholderText('projects.projectPathPlaceholder')
    .filter((input) => (input as HTMLInputElement).value === '/workspace/alpha');

  assert.ok(folderInputs.length > 0, 'the editor must show the current project folder');
});

test('saving the editor hands the edited folder to the save callback', () => {
  const saved: Array<[string, string, string]> = [];

  render(
    React.createElement(
      SidebarProjectItem,
      itemProps({
        renamePathDraft: '/workspace/beta',
        onSaveProjectName: (projectId: string, nextName: string, nextPath: string) => {
          saved.push([projectId, nextName, nextPath]);
        },
      }),
    ),
  );

  const folderInput = screen
    .getAllByPlaceholderText('projects.projectPathPlaceholder')
    .find((input) => (input as HTMLInputElement).value === '/workspace/beta');
  assert.ok(folderInput);

  fireEvent.keyDown(folderInput, { key: 'Enter' });

  assert.deepEqual(saved, [['a', 'alpha', '/workspace/beta']]);
});
