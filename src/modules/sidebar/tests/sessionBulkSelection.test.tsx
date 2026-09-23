import assert from 'node:assert/strict';

import { act, fireEvent, render, renderHook, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, test, vi } from 'vitest';

import type { Project, SessionWithProvider, SidebarProjectListProps, SidebarSessionSelection } from '@/shared/types';

/**
 * Bulk-deleting a project's conversations (issue #814). The list resolves which
 * rows a bulk delete may touch, and the controller performs it: these tests
 * cover both ends — that a running session can never be ticked, counted or
 * handed to the confirmation, and that confirming deletes every id once and
 * says so when only some of them went.
 */

const deleteSession = vi.fn();
const alertMock = vi.fn();

vi.mock('@/shared/api', () => ({
  api: {
    deleteSession: (sessionId: string, hardDelete?: boolean) => deleteSession(sessionId, hardDelete),
    archivedProjects: () => Promise.resolve({ ok: true, json: async () => ({ data: { projects: [] } }) }),
    getArchivedSessions: () => Promise.resolve({ ok: true, json: async () => ({ data: { sessions: [] } }) }),
    recentConversations: () =>
      Promise.resolve({ ok: true, json: async () => ({ data: { conversations: [], total: 0, hasMore: false } }) }),
    migrateLegacyProjectStars: () => Promise.resolve({ ok: true, json: async () => ({}) }),
  },
}));

const recordedOptionsProps: Record<string, unknown>[] = [];

vi.mock('@/modules/sidebar/SessionOptions', () => ({
  default: (props: Record<string, unknown>) => {
    recordedOptionsProps.push(props);
    return null;
  },
}));

// The breakpoint hook caches one MediaQueryList for the whole module, so the
// compact layout is selected through the mock rather than by resizing jsdom.
let isCompactLayout = false;

vi.mock('@/modules/sidebar/hooks/useCompactSidebar', () => ({
  useCompactSidebar: () => isCompactLayout,
}));

const { default: SidebarProjectSessions } = await import('@/modules/sidebar/SidebarProjectSessions');
const { useSidebarController } = await import('@/modules/sidebar/hooks/useSidebarController');

const NOW = new Date('2026-08-21T10:00:00.000Z');
const noop = () => {};

// Keys come back as `key` or `key:count`, so a label can be asserted together
// with the number it was rendered with.
const t = ((key: string, options?: unknown) =>
  options && typeof options === 'object' && 'count' in (options as Record<string, unknown>)
    ? `${key}:${(options as { count: number }).count}`
    : key) as unknown as SidebarProjectListProps['t'];

const PROJECT = {
  projectId: 'project-1',
  name: 'project-1',
  displayName: 'project one',
  fullPath: '/repo',
  sessions: [],
} as unknown as Project;

const session = (id: string): SessionWithProvider =>
  ({ id, summary: `session ${id}`, lastActivity: '2026-08-21T09:59:00.000Z', __provider: 'claude' }) as unknown as SessionWithProvider;

const SESSIONS = [session('s1'), session('s2'), session('s3')];
// Held outside the hook call: `projects` is an effect dependency in the
// controller, so rebuilding the array per render would re-run those effects
// forever instead of testing anything.
const PROJECTS = [PROJECT];

const NO_IDS: ReadonlySet<string> = new Set<string>();

type ListOverrides = {
  selectedSessionIds?: ReadonlySet<string> | null;
  activeSessions?: ReadonlySet<string>;
  hasMoreSessions?: boolean;
  onSetSessionSelection?: (selection: SidebarSessionSelection) => void;
  onToggleSessionSelected?: (projectId: string, sessionId: string) => void;
  onCancelSessionSelection?: () => void;
  onDeleteSelectedSessions?: (sessionIds: string[]) => void;
};

const renderSessions = (overrides: ListOverrides = {}) =>
  render(
    React.createElement(SidebarProjectSessions, {
      project: PROJECT,
      isExpanded: true,
      sessions: SESSIONS,
      selectedSession: null,
      initialSessionsLoaded: true,
      hasMoreSessions: false,
      isLoadingMoreSessions: false,
      activeSessions: NO_IDS,
      backgroundSessionIds: NO_IDS,
      attentionSessionIds: NO_IDS,
      currentTime: NOW,
      sessionRenameId: null,
      sessionRenameDraft: '',
      onRenameDraftChange: noop,
      onStartEditingSession: noop,
      onCancelEditingSession: noop,
      onSaveEditingSession: noop,
      onProjectSelect: noop,
      onSessionSelect: noop,
      onDeleteSession: noop,
      onLoadMoreSessions: noop,
      onNewSession: noop,
      selectedSessionIds: null,
      onSetSessionSelection: noop,
      onToggleSessionSelected: noop,
      onCancelSessionSelection: noop,
      onDeleteSelectedSessions: noop,
      t,
      ...overrides,
    }),
  );

const buttonWithText = (container: HTMLElement, text: string): HTMLButtonElement | null =>
  [...container.querySelectorAll('button')].find((button) => button.textContent?.trim() === text) ?? null;

const checkboxes = (container: HTMLElement): HTMLElement[] =>
  [...container.querySelectorAll<HTMLElement>('[role="checkbox"]')];

beforeEach(() => {
  isCompactLayout = false;
  recordedOptionsProps.length = 0;
  deleteSession.mockReset();
  deleteSession.mockResolvedValue({ ok: true, text: async () => '' });
  alertMock.mockReset();
  vi.stubGlobal('alert', alertMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

test('the idle list offers Select and opens an empty selection with it', () => {
  const onSetSessionSelection = vi.fn();
  const { container } = renderSessions({ onSetSessionSelection });

  assert.equal(checkboxes(container).length, 0, 'no row acts as a checkbox before selecting');
  assert.equal(recordedOptionsProps.length, SESSIONS.length, 'every row still has its options menu');

  const selectButton = buttonWithText(container, 'sessions.select');
  assert.ok(selectButton, 'the idle list offers to start selecting');

  fireEvent.click(selectButton);
  const selection = onSetSessionSelection.mock.calls[0][0] as SidebarSessionSelection;
  assert.equal(selection.projectId, PROJECT.projectId);
  assert.deepEqual([...selection.sessionIds], [], 'selection mode opens with nothing ticked');
});

test('a list whose every session is running has nothing to offer Select for', () => {
  const { container } = renderSessions({ activeSessions: new Set(['s1', 's2', 's3']) });

  assert.equal(buttonWithText(container, 'sessions.select'), null);
});

test('selection mode replaces the row options with a checkbox on every row', () => {
  const { container } = renderSessions({ selectedSessionIds: NO_IDS });

  assert.equal(checkboxes(container).length, SESSIONS.length);
  assert.deepEqual(
    checkboxes(container).map((row) => row.getAttribute('aria-checked')),
    ['false', 'false', 'false'],
  );
  assert.equal(recordedOptionsProps.length, 0, 'the per-row options menu is hidden while selecting');
  assert.equal(buttonWithText(container, 'sessions.select'), null);
  assert.ok(buttonWithText(container, 'sessions.selectAll'));
  assert.ok(buttonWithText(container, 'actions.cancel'));

  const deleteButton = buttonWithText(container, 'sessions.deleteSelected:0');
  assert.ok(deleteButton);
  assert.equal(deleteButton.disabled, true, 'nothing ticked means nothing to delete');
});

test('clicking or pressing space on a row ticks it', () => {
  const onToggleSessionSelected = vi.fn();
  const { container } = renderSessions({ selectedSessionIds: NO_IDS, onToggleSessionSelected });

  fireEvent.click(checkboxes(container)[0]);
  assert.deepEqual(onToggleSessionSelected.mock.calls[0], ['project-1', 's1']);

  fireEvent.keyDown(checkboxes(container)[1], { key: ' ' });
  assert.deepEqual(onToggleSessionSelected.mock.calls[1], ['project-1', 's2']);
});

test('a running row cannot be ticked and is left out of Select all', () => {
  const onToggleSessionSelected = vi.fn();
  const onSetSessionSelection = vi.fn();
  const { container } = renderSessions({
    selectedSessionIds: NO_IDS,
    activeSessions: new Set(['s2']),
    onToggleSessionSelected,
    onSetSessionSelection,
  });

  const runningRow = checkboxes(container)[1];
  assert.equal(runningRow.getAttribute('aria-disabled'), 'true');
  fireEvent.click(runningRow);
  fireEvent.keyDown(runningRow, { key: ' ' });
  assert.equal(onToggleSessionSelected.mock.calls.length, 0);

  fireEvent.click(buttonWithText(container, 'sessions.selectAll') as HTMLButtonElement);
  assert.deepEqual(
    [...(onSetSessionSelection.mock.calls[0][0] as SidebarSessionSelection).sessionIds],
    ['s1', 's3'],
  );
});

test('a ticked row that starts running drops out of the count and the ids to delete', () => {
  const onDeleteSelectedSessions = vi.fn();
  const { container } = renderSessions({
    selectedSessionIds: new Set(['s1', 's2']),
    activeSessions: new Set(['s2']),
    onDeleteSelectedSessions,
  });

  assert.deepEqual(
    checkboxes(container).map((row) => row.getAttribute('aria-checked')),
    ['true', 'false', 'false'],
    'the row that started running is drawn unticked, not as a locked tick',
  );

  const deleteButton = buttonWithText(container, 'sessions.deleteSelected:1');
  assert.ok(deleteButton, 'the running row is out of the count');
  fireEvent.click(deleteButton);
  assert.deepEqual(onDeleteSelectedSessions.mock.calls[0][0], ['s1']);
});

test('Select all flips to Clear only once it really covers the whole list', () => {
  const onSetSessionSelection = vi.fn();
  const everything = new Set(['s1', 's2', 's3']);

  const loaded = renderSessions({ selectedSessionIds: everything, onSetSessionSelection });
  fireEvent.click(buttonWithText(loaded.container, 'sessions.clearSelection') as HTMLButtonElement);
  assert.deepEqual([...(onSetSessionSelection.mock.calls[0][0] as SidebarSessionSelection).sessionIds], []);
  loaded.unmount();

  const partial = renderSessions({
    selectedSessionIds: everything,
    hasMoreSessions: true,
    onSetSessionSelection,
  });
  assert.equal(
    buttonWithText(partial.container, 'sessions.clearSelection'),
    null,
    'with sessions still unloaded the button must not claim everything is selected',
  );
  assert.ok(buttonWithText(partial.container, 'sessions.selectAllLoaded'));
});

test('the compact layout selects with the same rules and hides its options button', () => {
  isCompactLayout = true;
  const onToggleSessionSelected = vi.fn();
  const { container } = renderSessions({
    selectedSessionIds: new Set(['s1']),
    activeSessions: new Set(['s3']),
    onToggleSessionSelected,
  });

  const rows = checkboxes(container);
  assert.equal(rows.length, SESSIONS.length);
  assert.deepEqual(rows.map((row) => row.getAttribute('aria-checked')), ['true', 'false', 'false']);
  assert.equal(
    container.querySelector('[aria-label^="Session options for"]'),
    null,
    'the mobile row hides its "..." button while selecting',
  );

  fireEvent.click(rows[1]);
  assert.deepEqual(onToggleSessionSelected.mock.calls[0], ['project-1', 's2']);

  fireEvent.keyDown(rows[1], { key: ' ' });
  assert.deepEqual(onToggleSessionSelected.mock.calls[1], ['project-1', 's2']);

  fireEvent.click(rows[2]);
  assert.equal(onToggleSessionSelected.mock.calls.length, 2, 'the running row stays locked on touch too');
});

const renderController = (onSessionDelete = vi.fn()) =>
  renderHook(() =>
    useSidebarController({
      projects: PROJECTS,
      selectedProject: null,
      selectedSession: null,
      activeSessions: NO_IDS,
      isLoading: false,
      isMobile: false,
      t,
      onRefresh: noop,
      onProjectSelect: noop,
      onSessionSelect: noop,
      onSessionDelete,
      onLoadMoreSessions: noop,
      onProjectDelete: noop,
      setCurrentProject: noop,
      setSidebarVisible: noop,
      sidebarVisible: true,
    }),
  );

test('confirming a bulk delete deletes every id once and clears the selection', async () => {
  const onSessionDelete = vi.fn();
  const { result } = renderController(onSessionDelete);

  act(() => {
    result.current.setProjectSessionSelection({ projectId: 'project-1', sessionIds: new Set(['s1', 's2']) });
    result.current.showDeleteSelectedSessionsConfirmation(['s1', 's2']);
  });

  assert.deepEqual(result.current.pendingDeletion, { kind: 'sessions', sessionIds: ['s1', 's2'] });

  await act(async () => {
    await result.current.confirmDeleteSessions(true);
  });

  assert.deepEqual(deleteSession.mock.calls, [['s1', true], ['s2', true]]);
  assert.deepEqual(onSessionDelete.mock.calls, [['s1'], ['s2']]);
  assert.equal(result.current.pendingDeletion, null);
  assert.equal(result.current.sessionSelection, null);
  assert.equal(alertMock.mock.calls.length, 0);
});

test('a bulk delete that only partly succeeds keeps the rest and says how many failed', async () => {
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  deleteSession.mockImplementation((sessionId: string) =>
    sessionId === 's2'
      ? Promise.resolve({ ok: false, status: 500, text: async () => 'boom' })
      : Promise.resolve({ ok: true, text: async () => '' }),
  );

  const onSessionDelete = vi.fn();
  const { result } = renderController(onSessionDelete);

  act(() => {
    result.current.showDeleteSelectedSessionsConfirmation(['s1', 's2', 's3']);
  });

  await act(async () => {
    await result.current.confirmDeleteSessions(false);
  });

  assert.deepEqual(onSessionDelete.mock.calls, [['s1'], ['s3']], 'the sessions that went are still reported');
  assert.equal(alertMock.mock.calls.length, 1);
  assert.equal(alertMock.mock.calls[0][0], 'messages.deleteSessionsPartialFailure');
  consoleError.mockRestore();
});

test('the confirmation callback keeps its identity while rows are ticked', async () => {
  const { result } = renderController();
  await waitFor(() => assert.equal(result.current.sessionSelection, null));

  const before = result.current.showDeleteSelectedSessionsConfirmation;

  act(() => {
    result.current.toggleSessionSelected('project-1', 's1');
  });
  act(() => {
    result.current.toggleSessionSelected('project-1', 's2');
  });

  assert.deepEqual([...(result.current.sessionSelection?.sessionIds ?? [])], ['s1', 's2']);
  assert.equal(
    result.current.showDeleteSelectedSessionsConfirmation,
    before,
    'a callback that changes per tick re-renders every memoized project row',
  );
});

test('ticking a row of another project starts that project over', () => {
  const { result } = renderController();

  act(() => {
    result.current.toggleSessionSelected('project-1', 's1');
  });
  act(() => {
    result.current.toggleSessionSelected('project-2', 'other');
  });

  assert.equal(result.current.sessionSelection?.projectId, 'project-2');
  assert.deepEqual([...(result.current.sessionSelection?.sessionIds ?? [])], ['other']);
});

test('the selection is dropped when the project collapses or the tab changes', () => {
  const { result } = renderController();

  act(() => {
    result.current.toggleSessionSelected('project-1', 's1');
  });
  act(() => {
    result.current.toggleProject('project-1');
  });
  assert.equal(result.current.sessionSelection, null, 'collapsing takes the ticked rows off screen');

  act(() => {
    result.current.toggleSessionSelected('project-1', 's1');
  });
  act(() => {
    result.current.setSearchMode('conversations');
  });
  assert.equal(result.current.sessionSelection, null, 'so does leaving the Projects tab');
});

test('an empty selection opens no confirmation', () => {
  const { result } = renderController();

  act(() => {
    result.current.showDeleteSelectedSessionsConfirmation([]);
  });

  assert.equal(result.current.pendingDeletion, null);
});
