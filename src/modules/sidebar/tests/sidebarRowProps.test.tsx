import assert from 'node:assert/strict';

import { render } from '@testing-library/react';
import React from 'react';
import { beforeEach, test, vi } from 'vitest';

import type { ActiveSidebarRename, Project, SidebarProjectListProps } from '@/shared/types';

/**
 * SidebarProjectItem and SidebarSessionItem are memoized because a websocket
 * session delta re-renders the sidebar every 0.5-2s during a run, and a rename
 * re-renders it per keystroke. A memo boundary is worth nothing unless the rows
 * that did not change are handed referentially identical props, so that is what
 * these tests assert — on the real prop objects, captured from a real render.
 */

const recordedProjectRowProps: Record<string, unknown>[] = [];
const recordedSessionRowProps: Record<string, unknown>[] = [];

vi.mock('@/modules/sidebar/SidebarProjectItem', () => ({
  default: (props: Record<string, unknown>) => {
    recordedProjectRowProps.push(props);
    return null;
  },
}));

vi.mock('@/modules/sidebar/SidebarSessionItem', () => ({
  default: (props: Record<string, unknown>) => {
    recordedSessionRowProps.push(props);
    return null;
  },
}));

const { default: SidebarProjectList } = await import('@/modules/sidebar/SidebarProjectList');
const { default: SidebarProjectSessions } = await import('@/modules/sidebar/SidebarProjectSessions');
const { getAllSessions } = await import('@/modules/sidebar/utils/sidebarProjectFormatting');

const makeProject = (projectId: string, sessionIds: string[]): Project => ({
  projectId,
  name: projectId,
  displayName: projectId,
  fullPath: `/tmp/${projectId}`,
  sessions: sessionIds.map((id) => ({
    id,
    summary: id,
    lastActivity: '2026-08-21T10:00:00.000Z',
  })),
}) as unknown as Project;

const PROJECT_A = makeProject('a', ['a1', 'a2']);
const PROJECT_B = makeProject('b', ['b1']);

const noop = () => {};
const t = ((key: string) => key) as unknown as SidebarProjectListProps['t'];
const NOW = new Date('2026-08-21T10:00:00.000Z');

// Held outside listProps because the caller owns their stability in production:
// activeSessions is useBusySessionIdSet(), which only changes identity when
// membership changes, and attentionSessionIds is passed into Sidebar from above.
// Rebuilding them per render here would test the harness, not the component.
const NO_SESSION_IDS: ReadonlySet<string> = new Set<string>();

const listProps = (activeRename: ActiveSidebarRename | null): SidebarProjectListProps => ({
  projects: [PROJECT_A, PROJECT_B],
  filteredProjects: [PROJECT_A, PROJECT_B],
  selectedProject: null,
  selectedSession: null,
  isLoading: false,
  loadingProgress: null,
  expandedProjects: new Set(),
  activeRename,
  initialSessionsLoaded: new Set(),
  currentTime: NOW,
  deletingProjects: new Set(),
  tasksEnabled: false,
  mcpServerStatus: null,
  getProjectSessions: getAllSessions,
  onLoadMoreSessions: noop,
  loadingMoreProjects: new Set(),
  activeSessions: NO_SESSION_IDS,
  attentionSessionIds: NO_SESSION_IDS,
  isProjectStarred: () => false,
  onRenameDraftChange: noop,
  onToggleProject: noop,
  onProjectSelect: noop,
  onToggleStarProject: noop,
  onStartEditingProject: noop,
  onCancelEditingProject: noop,
  onSaveProjectName: noop,
  onDeleteProject: noop,
  onSessionSelect: noop,
  onDeleteSession: noop,
  onNewSession: noop,
  onStartEditingSession: noop,
  onCancelEditingSession: noop,
  onSaveEditingSession: noop,
  t,
});

/** Exactly what a memo boundary compares: every prop, shallowly. */
const changedProps = (before: Record<string, unknown>, after: Record<string, unknown>): string[] =>
  [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter((key) => !Object.is(before[key], after[key]));

beforeEach(() => {
  recordedProjectRowProps.length = 0;
  recordedSessionRowProps.length = 0;
});

test('renaming a project changes props on that row only', () => {
  const { rerender } = render(
    React.createElement(SidebarProjectList, listProps({ target: 'project', id: 'a', draft: 'N' })),
  );
  const [firstA, firstB] = recordedProjectRowProps;

  rerender(
    React.createElement(SidebarProjectList, listProps({ target: 'project', id: 'a', draft: 'Ne' })),
  );
  const [, , secondA, secondB] = recordedProjectRowProps;

  assert.deepEqual(changedProps(firstA, secondA), ['renameDraft']);
  assert.deepEqual(
    changedProps(firstB, secondB),
    [],
    'the other project row must be handed identical props, or its memo cannot bail',
  );
});

test('renaming a session changes props on the owning project row only', () => {
  const rename = (draft: string): ActiveSidebarRename =>
    ({ target: 'session', id: 'a1', projectId: 'a', draft });

  const { rerender } = render(React.createElement(SidebarProjectList, listProps(rename('N'))));
  const [firstA, firstB] = recordedProjectRowProps;

  rerender(React.createElement(SidebarProjectList, listProps(rename('Ne'))));
  const [, , secondA, secondB] = recordedProjectRowProps;

  assert.deepEqual(changedProps(firstA, secondA), ['sessionRenameDraft']);
  assert.deepEqual(
    changedProps(firstB, secondB),
    [],
    'a session rename in project a must not touch project b',
  );
});

test('a session rename does not put a same-id project row into edit mode', () => {
  // The two id spaces are independent; without the target discriminator a
  // session and a project sharing an id would both go into edit mode.
  render(React.createElement(
    SidebarProjectList,
    listProps({ target: 'session', id: 'a', projectId: 'a', draft: 'x' }),
  ));

  assert.equal(recordedProjectRowProps[0].isEditing, false);
});

test('the fork callback reaches the rows that render the fork action', () => {
  // `onForkSession` is optional on every component between Sidebar and the
  // session row, so dropping it type-checks perfectly and shows up only as a
  // missing item in a menu. That is exactly how it went missing.
  const onForkSession = () => {};
  render(React.createElement(SidebarProjectList, { ...listProps(null), onForkSession }));

  assert.equal(recordedProjectRowProps[0].onForkSession, onForkSession);
});

const sessionsProps = (sessionRenameId: string | null, sessionRenameDraft: string) => ({
  project: PROJECT_A,
  isExpanded: true,
  sessions: getAllSessions(PROJECT_A),
  selectedSession: null,
  initialSessionsLoaded: true,
  hasMoreSessions: false,
  isLoadingMoreSessions: false,
  activeSessions: NO_SESSION_IDS,
  attentionSessionIds: NO_SESSION_IDS,
  currentTime: NOW,
  sessionRenameId,
  sessionRenameDraft,
  onRenameDraftChange: noop,
  onStartEditingSession: noop,
  onCancelEditingSession: noop,
  onSaveEditingSession: noop,
  onProjectSelect: noop,
  onSessionSelect: noop,
  onDeleteSession: noop,
  onLoadMoreSessions: noop,
  onNewSession: noop,
  t,
});

test('within a project, a keystroke changes props on the renamed session row only', () => {
  const { rerender } = render(
    React.createElement(SidebarProjectSessions, sessionsProps('a1', 'N')),
  );
  const [firstA1, firstA2] = recordedSessionRowProps;

  rerender(React.createElement(SidebarProjectSessions, sessionsProps('a1', 'Ne')));
  const [, , secondA1, secondA2] = recordedSessionRowProps;

  assert.deepEqual(changedProps(firstA1, secondA1), ['renameDraft']);
  assert.deepEqual(
    changedProps(firstA2, secondA2),
    [],
    'the sibling session row must be handed a constant, not the live draft',
  );
});

test('the sorted session list is the same array until the project itself changes', () => {
  // A fresh array here is on its own enough to defeat every row memo below it.
  assert.equal(getAllSessions(PROJECT_A), getAllSessions(PROJECT_A));

  const replaced = { ...PROJECT_A };
  assert.notEqual(
    getAllSessions(replaced),
    getAllSessions(PROJECT_A),
    'a replaced project must not read a stale entry',
  );
});
