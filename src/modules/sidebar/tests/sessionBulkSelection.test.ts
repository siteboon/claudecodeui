import assert from 'node:assert/strict';

import { act, fireEvent, render, renderHook, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, test, vi } from 'vitest';

import type { Project, SessionWithProvider, SidebarProjectListProps, SidebarSessionSelection } from '@/shared/types';

/**
 * Bulk-deleting a project's sessions. The list resolves which rows a bulk
 * delete may touch, and the controller performs it: these tests cover both
 * ends — that a running session can never be ticked, counted or deleted, and
 * that confirming deletes every id once, keeps the rest of the sidebar in step
 * and says so when only some of them went.
 */

const deleteSession = vi.fn();
const getArchivedSessions = vi.fn();
const recentConversations = vi.fn();
const alertMock = vi.fn();

vi.mock('@/shared/api', () => ({
  api: {
    deleteSession: (sessionId: string, hardDelete?: boolean) => deleteSession(sessionId, hardDelete),
    archivedProjects: () => Promise.resolve({ ok: true, json: async () => ({ data: { projects: [] } }) }),
    getArchivedSessions: () => getArchivedSessions(),
    recentConversations: () => recentConversations(),
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

// Keys come back with their interpolation options appended (`key:count=2,total=3`),
// so a label or a message can be asserted together with the numbers it was given.
const t = ((key: string, options?: unknown) =>
  options && typeof options === 'object'
    ? `${key}:${Object.entries(options).map(([name, value]) => `${name}=${String(value)}`).join(',')}`
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
  sessions?: SessionWithProvider[];
  selectedSessionIds?: ReadonlySet<string> | null;
  activeSessions?: ReadonlySet<string>;
  hasMoreSessions?: boolean;
  onLoadMoreSessions?: (projectId: string) => void;
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

const jsonResponse = (data: unknown) => Promise.resolve({ ok: true, json: async () => ({ data }) });

beforeEach(() => {
  isCompactLayout = false;
  recordedOptionsProps.length = 0;
  deleteSession.mockReset();
  deleteSession.mockResolvedValue({ ok: true, text: async () => '' });
  getArchivedSessions.mockReset();
  getArchivedSessions.mockImplementation(() => jsonResponse({ sessions: [] }));
  recentConversations.mockReset();
  recentConversations.mockImplementation(() => jsonResponse({ conversations: [], total: 0, hasMore: false }));
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

  const deleteButton = buttonWithText(container, 'sessions.deleteSelected:count=0');
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

  const deleteButton = buttonWithText(container, 'sessions.deleteSelected:count=1');
  assert.ok(deleteButton, 'the running row is out of the count');
  fireEvent.click(deleteButton);
  assert.deepEqual(onDeleteSelectedSessions.mock.calls[0][0], ['s1']);
});

test('Select all flips to Clear once every loaded row is ticked', () => {
  const onSetSessionSelection = vi.fn();
  const everything = new Set(['s1', 's2', 's3']);

  const loaded = renderSessions({ selectedSessionIds: everything, onSetSessionSelection });
  fireEvent.click(buttonWithText(loaded.container, 'sessions.clearSelection') as HTMLButtonElement);
  assert.deepEqual([...(onSetSessionSelection.mock.calls[0][0] as SidebarSessionSelection).sessionIds], []);
  loaded.unmount();

  const unloadedLeft = renderSessions({
    selectedSessionIds: new Set(['s1']),
    hasMoreSessions: true,
    onSetSessionSelection,
  });
  assert.equal(
    buttonWithText(unloadedLeft.container, 'sessions.selectAll'),
    null,
    'with sessions still unloaded the button must not promise to select all of them',
  );
  fireEvent.click(buttonWithText(unloadedLeft.container, 'sessions.selectAllLoaded') as HTMLButtonElement);
  assert.deepEqual(
    [...(onSetSessionSelection.mock.calls[1][0] as SidebarSessionSelection).sessionIds],
    ['s1', 's2', 's3'],
  );
  unloadedLeft.unmount();

  const allLoadedTicked = renderSessions({
    selectedSessionIds: everything,
    hasMoreSessions: true,
    onSetSessionSelection,
  });
  fireEvent.click(buttonWithText(allLoadedTicked.container, 'sessions.clearSelection') as HTMLButtonElement);
  assert.deepEqual(
    [...(onSetSessionSelection.mock.calls[2][0] as SidebarSessionSelection).sessionIds],
    [],
    'once the loaded rows are all ticked the same button can untick them again',
  );
});

test('a page emptied by deleting every loaded row keeps Load more', () => {
  const onLoadMoreSessions = vi.fn();
  const emptied = renderSessions({ sessions: [], hasMoreSessions: true, onLoadMoreSessions });

  assert.equal(
    emptied.container.textContent?.includes('sessions.noSessions'),
    false,
    'the server still has sessions, so the list must not say there are none',
  );
  const loadMore = buttonWithText(emptied.container, 'Load more sessions');
  assert.ok(loadMore, 'the rest of the sessions stay reachable without a refresh');
  fireEvent.click(loadMore);
  assert.deepEqual(onLoadMoreSessions.mock.calls, [['project-1']]);
  emptied.unmount();

  const reallyEmpty = renderSessions({ sessions: [], hasMoreSessions: false });
  assert.equal(reallyEmpty.container.textContent?.includes('sessions.noSessions'), true);
  assert.equal(buttonWithText(reallyEmpty.container, 'Load more sessions'), null);
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

type SessionActivity = {
  activeSessions: ReadonlySet<string>;
  backgroundSessionIds: ReadonlySet<string>;
};

const IDLE: SessionActivity = { activeSessions: NO_IDS, backgroundSessionIds: NO_IDS };

const renderController = (onSessionDelete = vi.fn(), initialActivity: SessionActivity = IDLE) =>
  renderHook(
    ({ activeSessions, backgroundSessionIds }: SessionActivity) =>
      useSidebarController({
        projects: PROJECTS,
        selectedProject: null,
        selectedSession: null,
        activeSessions,
        backgroundSessionIds,
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
    { initialProps: initialActivity },
  );

// A deleteSession response the test settles by hand, to look at the sidebar
// while the requests are still out.
const deferredDelete = () => {
  let settle: (response: { ok: boolean; text: () => Promise<string> }) => void = noop;
  const promise = new Promise((resolve) => {
    settle = resolve;
  });
  return { promise, succeed: () => settle({ ok: true, text: async () => '' }) };
};

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

test('a bulk delete that only partly succeeds keeps the failed rows ticked and says how many failed', async () => {
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  deleteSession.mockImplementation((sessionId: string) =>
    sessionId === 's2'
      ? Promise.resolve({ ok: false, status: 500, text: async () => 'boom' })
      : Promise.resolve({ ok: true, text: async () => '' }),
  );

  const onSessionDelete = vi.fn();
  const { result } = renderController(onSessionDelete);

  act(() => {
    result.current.setProjectSessionSelection({ projectId: 'project-1', sessionIds: new Set(['s1', 's2', 's3']) });
    result.current.showDeleteSelectedSessionsConfirmation(['s1', 's2', 's3']);
  });

  await act(async () => {
    await result.current.confirmDeleteSessions(false);
  });

  assert.deepEqual(onSessionDelete.mock.calls, [['s1'], ['s3']], 'the sessions that went are still reported');
  assert.deepEqual(alertMock.mock.calls, [['messages.deleteSessionsPartialFailure:count=1,total=3']]);
  assert.equal(result.current.sessionSelection?.projectId, 'project-1');
  assert.deepEqual(
    [...(result.current.sessionSelection?.sessionIds ?? [])],
    ['s2'],
    'the row that could not be deleted stays ticked for a retry',
  );
  consoleError.mockRestore();
});

test('a bulk delete prunes the recents feed, lowers its total and refetches the archive', async () => {
  recentConversations.mockImplementation(() =>
    jsonResponse({
      conversations: ['s1', 's2', 's9'].map((sessionId) => ({ sessionId, provider: 'claude', projectId: 'project-1' })),
      total: 7,
      hasMore: true,
    }),
  );
  const { result } = renderController();

  act(() => {
    result.current.setSearchMode('conversations');
  });
  await waitFor(() => assert.equal(result.current.recentConversations.length, 3));
  assert.equal(result.current.recentConversationsTotal, 7);
  const archiveFetchesBefore = getArchivedSessions.mock.calls.length;

  act(() => {
    result.current.showDeleteSelectedSessionsConfirmation(['s1', 's2']);
  });
  await act(async () => {
    await result.current.confirmDeleteSessions(false);
  });

  assert.deepEqual(result.current.recentConversations.map((conversation) => conversation.sessionId), ['s9']);
  assert.equal(result.current.recentConversationsTotal, 5, 'the total drops by the rows that left the feed');
  assert.equal(getArchivedSessions.mock.calls.length, archiveFetchesBefore + 1, 'the archive is refetched once');
});

test('accepting the dialog ends selection mode at once, and a second confirmation cannot resend the same ids', async () => {
  const pending = { s1: deferredDelete(), s2: deferredDelete() };
  deleteSession.mockImplementation((sessionId: 's1' | 's2') => pending[sessionId].promise);
  const onSessionDelete = vi.fn();
  const { result } = renderController(onSessionDelete);
  // Read through a function so the assertion below that the selection is gone
  // does not narrow it to `null` for the rest of the test.
  const tickedSessionIds = () => [...(result.current.sessionSelection?.sessionIds ?? [])];

  act(() => {
    result.current.setProjectSessionSelection({ projectId: 'project-1', sessionIds: new Set(['s1', 's2']) });
    result.current.showDeleteSelectedSessionsConfirmation(['s1', 's2']);
  });

  let firstConfirmation: Promise<void> = Promise.resolve();
  act(() => {
    firstConfirmation = result.current.confirmDeleteSessions(false);
  });
  assert.equal(result.current.sessionSelection, null, 'the Delete button is gone while the requests are out');

  // The rows are still on screen, so they can be ticked and confirmed again.
  act(() => {
    result.current.showDeleteSelectedSessionsConfirmation(['s1', 's2']);
  });
  await act(async () => {
    await result.current.confirmDeleteSessions(false);
  });
  assert.deepEqual(deleteSession.mock.calls, [['s1', false], ['s2', false]], 'no id is sent twice');

  // A selection started meanwhile belongs to the user, not to the delete.
  act(() => {
    result.current.toggleSessionSelected('project-1', 's3');
  });

  await act(async () => {
    pending.s1.succeed();
    pending.s2.succeed();
    await firstConfirmation;
  });

  assert.deepEqual(onSessionDelete.mock.calls, [['s1'], ['s2']]);
  assert.deepEqual(tickedSessionIds(), ['s3']);
  assert.equal(alertMock.mock.calls.length, 0, 'nothing failed, so nothing is reported');
});

test('a session that starts a response while the dialog is open is skipped, not deleted or counted as failed', async () => {
  const onSessionDelete = vi.fn();
  const { result, rerender } = renderController(onSessionDelete);

  act(() => {
    result.current.showDeleteSelectedSessionsConfirmation(['s1', 's2', 's3']);
  });

  // s2 now has a response in flight; s3 is busy only with background work,
  // which the rows treat as deletable too.
  rerender({ activeSessions: new Set(['s2', 's3']), backgroundSessionIds: new Set(['s3']) });

  await act(async () => {
    await result.current.confirmDeleteSessions(true);
  });

  assert.deepEqual(deleteSession.mock.calls, [['s1', true], ['s3', true]]);
  assert.deepEqual(onSessionDelete.mock.calls, [['s1'], ['s3']]);
  assert.equal(alertMock.mock.calls.length, 0);
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
