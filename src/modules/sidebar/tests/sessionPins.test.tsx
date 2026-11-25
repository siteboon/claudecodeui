import assert from 'node:assert/strict';

import { act, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import type { ComponentProps, ReactNode } from 'react';
import { useState } from 'react';
import type { TFunction } from 'i18next';
import { beforeEach, test, vi } from 'vitest';

import type { Project, RecentConversationListItem, SessionRowActions, SidebarProjectListProps } from '@/shared/types';
import { SessionPinsProvider } from '@/modules/sidebar/SessionPinsProvider';
import { useSessionPins } from '@/modules/sidebar/hooks/useSessionPins';
import SidebarContent from '@/modules/sidebar/SidebarContent';
import SidebarRecentConversations from '@/modules/sidebar/SidebarRecentConversations';

const mocks = vi.hoisted(() => ({
  load: vi.fn(), save: vi.fn(),
}));
vi.mock('@/shared/api', () => ({
  api: { pinnedSessions: mocks.load, setSessionPinned: mocks.save },
}));
vi.mock('@/shared/hooks/useProviderCapabilities', () => ({
  useSessionForkingProviders: () => new Set(['claude', 'codex']),
}));
vi.mock('@/modules/sidebar/SidebarHeader', () => ({ default: () => null }));
vi.mock('@/modules/sidebar/SidebarFooter', () => ({ default: () => null }));

const t = ((key: string, fallback?: string | { defaultValue?: string }) =>
  typeof fallback === 'string' ? fallback : fallback?.defaultValue ?? key) as TFunction;
const noop = () => {};
const EMPTY_PROJECTS: Project[] = [];
const NOW = new Date('2026-10-23T12:00:00Z');
const conversation = (sessionId: string): RecentConversationListItem => ({
  sessionId, provider: 'codex', projectId: 'project-1', projectDisplayName: 'Project one',
  sessionTitle: `Title ${sessionId}`, lastActivity: '2026-10-23T11:00:00Z',
});
const A = conversation('a'), B = conversation('b');
const PROJECTS: Project[] = [{
  projectId: 'project-1', fullPath: '/workspace/one', displayName: 'Project one',
  sessions: [{ id: 'a', summary: A.sessionTitle, __provider: 'codex' }, { id: 'b', summary: B.sessionTitle, __provider: 'codex' }],
  sessionMeta: { total: 2, hasMore: false },
}];
const actions: SessionRowActions = {
  activeRename: null, activeSessions: new Set(), backgroundSessionIds: new Set(), attentionSessionIds: new Set(),
  onRenameDraftChange: noop, onStartEditingSession: noop, onCancelEditingSession: noop,
  onSaveEditingSession: noop, onArchiveSession: noop, onDeleteSession: noop,
};
const listProps: SidebarProjectListProps = {
  ...actions, projects: PROJECTS, filteredProjects: PROJECTS, selectedProject: null, selectedSession: null,
  isLoading: false, loadingProgress: null, isProjectExpanded: () => true,
  initialSessionsLoaded: new Set(['project-1']), currentTime: NOW, deletingProjects: new Set(),
  getProjectSessions: (project) => (project.sessions ?? []).map((session) => ({ ...session, __provider: session.__provider ?? 'codex' })),
  onLoadMoreSessions: noop, loadingMoreProjects: new Set(), isProjectStarred: () => false,
  onToggleProject: noop, onProjectSelect: noop, onToggleStarProject: noop,
  onStartEditingProject: noop, onCancelEditingProject: noop, onSaveProjectName: noop, onDeleteProject: noop,
  onSessionSelect: noop, onNewSession: noop, sessionSelection: null, onSetSessionSelection: noop,
  onToggleSessionSelected: noop, onCancelSessionSelection: noop, onDeleteSelectedSessions: noop, t,
};
const contentProps = (mode: 'projects' | 'conversations'): ComponentProps<typeof SidebarContent> => ({
  isPWA: false, isMobile: false, isLoading: false, projects: PROJECTS,
  archivedProjects: [], archivedSessions: [], archivedSessionsCount: 0, isArchivedSessionsLoading: false,
  recentConversations: [A, B], recentConversationsTotal: 2, recentConversationsHasMore: false,
  isRecentConversationsLoading: false, isLoadingMoreRecentConversations: false, recentConversationsError: false,
  searchFilter: '', onSearchFilterChange: noop, onClearSearchFilter: noop, searchMode: mode,
  onSearchModeChange: noop, conversationResults: null, isSearching: false, searchProgress: null,
  onRestoreArchivedProject: noop, onLoadMoreRecentConversations: noop, onRetryRecentConversations: noop,
  onArchivedSessionClick: noop, onRestoreArchivedSession: noop, onDeleteArchivedSession: noop,
  onConversationResultClick: noop, onRefresh: noop, onCreateProject: noop,
  onCollapseSidebar: noop, updateAvailable: false, restartRequired: false, releaseInfo: null,
  latestVersion: null, currentVersion: '1.37.4', onShowVersionModal: noop, onShowSettings: noop,
  projectListProps: listProps, t,
});
const response = (sessions: RecentConversationListItem[]) => ({ ok: true, json: async () => ({ data: { sessions } }) });
const wrapper = ({ children }: { children: ReactNode }) => <SessionPinsProvider projects={EMPTY_PROJECTS}>{children}</SessionPinsProvider>;
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
}

/** Pins or unpins a session from its row's options menu. */
async function togglePin(scope: HTMLElement, title: string) {
  fireEvent.click(within(scope).getByRole('button', { name: `Session options for ${title}` }));
  const control = await screen.findByRole('menuitem', { name: /pin session/i });
  await waitFor(() => assert.equal(control.hasAttribute('disabled'), false));
  fireEvent.click(control);
}
/** The tree rows that carry the pinned marker. */
const pinnedIds = (tree: HTMLElement) => [...tree.querySelectorAll('[data-session-id]')]
  .filter((row) => row.querySelector('[aria-label="Pinned"]'))
  .map((row) => row.getAttribute('data-session-id'));

beforeEach(() => {
  mocks.load.mockReset().mockResolvedValue(response([A]));
  mocks.save.mockReset().mockResolvedValue(response([]));
});

test('both views list pins under their heading; Projects also lifts them inside their own project', async () => {
  mocks.load.mockResolvedValue(response([B]));
  const { rerender } = render(
    <SessionPinsProvider projects={PROJECTS}><SidebarContent {...contentProps('projects')} /></SessionPinsProvider>,
  );
  const projectTree = screen.getByTestId('project-session-tree');
  await waitFor(() => assert.deepEqual(pinnedIds(projectTree), ['b']), { timeout: 4000 });
  assert.ok(within(screen.getByTestId('pinned-sessions-section')).getByText('Title b'));
  assert.deepEqual([...screen.getByTestId('project-session-tree').querySelectorAll('[data-session-id]')].map((row) => row.getAttribute('data-session-id')), ['b', 'a']);
  assert.equal(within(projectTree).getAllByText('Title b').length, 1);

  rerender(<SessionPinsProvider projects={PROJECTS}><SidebarContent {...contentProps('conversations')} /></SessionPinsProvider>);
  const pinned = screen.getByTestId('pinned-sessions-section');
  const recent = screen.getByTestId('recent-conversations-list');
  assert.ok(within(pinned).getByText('Title b'));
  assert.ok(within(pinned).getByText('Project one'));
  assert.equal(screen.getAllByText('Title b').length, 1);
  assert.ok(within(recent).getByText('Title a'));
  assert.ok(pinned.compareDocumentPosition(recent) & Node.DOCUMENT_POSITION_FOLLOWING);
  assert.ok(within(pinned).getByText('Pinned'));
});

test('unpin uses the server response in both views and returns the session to the recent feed', async () => {
  const { rerender } = render(<SessionPinsProvider projects={PROJECTS}><SidebarContent {...contentProps('conversations')} /></SessionPinsProvider>);
  await waitFor(() => assert.ok(screen.queryByTestId('pinned-sessions-section')));
  await togglePin(screen.getByTestId('pinned-sessions-section'), 'Title a');
  await waitFor(() => assert.equal(Boolean(screen.queryByTestId('pinned-sessions-section')), false));
  assert.deepEqual(mocks.save.mock.calls.map(([id, pinned]) => [id, pinned]), [['a', false]]);
  assert.ok(within(screen.getByTestId('recent-conversations-list')).getByText('Title a'));
  rerender(<SessionPinsProvider projects={PROJECTS}><SidebarContent {...contentProps('projects')} /></SessionPinsProvider>);
  assert.equal(Boolean(screen.queryByTestId('pinned-sessions-section')), false);
});

test('project pins remain scoped to their owner and include older pages without altering pagination', async () => {
  const c = { ...conversation('c'), projectId: 'project-2', projectDisplayName: 'Project two' };
  const older = conversation('older');
  const projects: Project[] = [
    { ...PROJECTS[0], sessionMeta: { total: 20, hasMore: true } },
    { projectId: 'project-2', fullPath: '/workspace/two', displayName: 'Project two', sessions: [
      { id: 'd', summary: 'Title d', __provider: 'codex' },
      { id: 'c', summary: c.sessionTitle, __provider: 'codex' },
    ], sessionMeta: { total: 2, hasMore: false } },
  ];
  mocks.load.mockResolvedValue(response([c, older, B]));
  const more = vi.fn();
  const props = contentProps('projects');
  props.projects = projects;
  props.projectListProps = { ...listProps, projects, filteredProjects: projects,
    initialSessionsLoaded: new Set(['project-1', 'project-2']), onLoadMoreSessions: more };
  render(<SessionPinsProvider projects={projects}><SidebarContent {...props} /></SessionPinsProvider>);
  await waitFor(() => assert.ok(screen.queryAllByText('Title older').length > 0));
  const trees = screen.getAllByTestId('project-session-tree');
  const ids = (tree: HTMLElement) => [...tree.querySelectorAll('[data-session-id]')].map((row) => row.getAttribute('data-session-id'));
  assert.deepEqual(ids(trees[0]), ['older', 'b', 'a']);
  assert.deepEqual(ids(trees[1]), ['c', 'd']);
  assert.equal(within(trees[1]).getAllByText('Title c').length, 1);
  fireEvent.click(screen.getByRole('button', { name: 'Load more sessions' }));
  assert.deepEqual(more.mock.calls, [['project-1']]);
});

test('pinning any family member preserves its tree and marks only explicit pins', async () => {
  const projects: Project[] = [{ ...PROJECTS[0], sessions: [
    { id: 'newest', summary: 'Newest', __provider: 'codex' },
    { id: 'c', summary: 'Title c', __provider: 'codex', forkedFromSessionId: 'b' },
    { id: 'b', summary: 'Title b', __provider: 'codex', forkedFromSessionId: 'a' },
    { id: 'sibling', summary: 'Sibling', __provider: 'codex', forkedFromSessionId: 'a' },
    { id: 'a', summary: 'Title a', __provider: 'codex' },
  ] }];
  let savedPins: RecentConversationListItem[] = [];
  mocks.load.mockResolvedValue(response([]));
  mocks.save.mockImplementation(async (id: string, pinned: boolean) => {
    savedPins = pinned ? [conversation(id), ...savedPins] : savedPins.filter((pin) => pin.sessionId !== id);
    return response(savedPins);
  });
  const props = contentProps('projects');
  props.projectListProps = { ...listProps, projects, filteredProjects: projects };
  render(<SessionPinsProvider projects={projects}><SidebarContent {...props} /></SessionPinsProvider>);
  const tree = screen.getByTestId('project-session-tree');
  const treeUi = within(tree);
  const rows = () => [...tree.querySelectorAll('[data-session-id]')]
    .map((row) => [row.getAttribute('data-session-id'), row.getAttribute('data-parent-session-id'), row.getAttribute('data-fork-depth')]);
  const family = [['a', null, '0'], ['b', 'a', '1'], ['c', 'b', '2'], ['sibling', 'a', '1']];
  const newest = ['newest', null, '0'];
  assert.deepEqual(rows(), [newest, ...family]);

  for (const id of ['a', 'b', 'c']) {
    await togglePin(tree, `Title ${id}`);
    await waitFor(() => assert.deepEqual(rows(), [...family, newest]));
    assert.deepEqual(pinnedIds(tree), [id]);
    assert.equal(tree.querySelector('[data-session-id="b"] [data-fork-connector]')?.getAttribute('data-fork-connector'), 'branch');
    assert.equal(tree.querySelector('[data-session-id="sibling"] [data-fork-connector]')?.getAttribute('data-fork-connector'), 'last');
    fireEvent.click(within(tree.querySelector('[data-session-id="a"]') as HTMLElement).getByRole('button', { name: 'sessions.collapseForks' }));
    assert.deepEqual(rows(), [family[0], newest]);
    fireEvent.click(treeUi.getByRole('button', { name: 'sessions.expandForks' }));
    assert.deepEqual(rows(), [...family, newest]);
    await togglePin(tree, `Title ${id}`);
    await waitFor(() => assert.deepEqual(rows(), [newest, ...family]));
    assert.deepEqual(pinnedIds(tree), []);
  }

  // Removing one of multiple explicit pins must keep the family lifted.
  await togglePin(tree, 'Title a');
  await waitFor(() => assert.deepEqual(pinnedIds(tree), ['a']));
  await togglePin(tree, 'Title c');
  await waitFor(() => assert.deepEqual(pinnedIds(tree), ['a', 'c']));
  await togglePin(tree, 'Title a');
  await waitFor(() => assert.deepEqual(pinnedIds(tree), ['c']));
  assert.deepEqual(rows(), [...family, newest]);
  await togglePin(tree, 'Title c');
  await waitFor(() => assert.deepEqual(rows(), [newest, ...family]));
}, 15_000);

test('an off-page pinned ancestor keeps its own parent and paginated descendants', async () => {
  const projects: Project[] = [{ ...PROJECTS[0], sessions: [
    { id: 'newest', summary: 'Newest', __provider: 'codex' },
    { id: 'c', summary: 'Title c', __provider: 'codex', forkedFromSessionId: 'b', forkAncestors: [
      { id: 'b', summary: 'Old title b', __provider: 'codex', forkedFromSessionId: 'a' },
      { id: 'a', summary: 'Title a', __provider: 'codex' },
    ] },
  ], sessionMeta: { total: 30, hasMore: true } }];
  mocks.load.mockResolvedValue(response([B]));
  const props = contentProps('projects');
  const more = vi.fn();
  props.projectListProps = { ...listProps, projects, filteredProjects: projects, onLoadMoreSessions: more };
  render(<SessionPinsProvider projects={projects}><SidebarContent {...props} /></SessionPinsProvider>);
  const tree = screen.getByTestId('project-session-tree');
  await waitFor(() => assert.deepEqual(pinnedIds(tree), ['b']));
  assert.deepEqual([...tree.querySelectorAll('[data-session-id]')].map((row) => [
    row.getAttribute('data-session-id'), row.getAttribute('data-parent-session-id'), row.getAttribute('data-fork-depth'),
  ]), [['a', null, '0'], ['b', 'a', '1'], ['c', 'b', '2'], ['newest', null, '0']]);
  assert.equal(within(tree).getAllByText('Title b').length, 1);
  fireEvent.click(screen.getByRole('button', { name: 'Load more sessions' }));
  assert.deepEqual(more.mock.calls, [['project-1']]);
});

test.each(['project-session-tree', 'pinned-sessions-section'])('renaming a pinned session from the %s opens one editor, in that list', async (listTestId) => {
  function RenameHarness() {
    const [activeRename, setActiveRename] = useState<SessionRowActions['activeRename']>(null);
    const props = contentProps('projects');
    props.projectListProps = {
      ...listProps, activeRename,
      onStartEditingSession: (projectId, id, draft, origin) => setActiveRename({ target: 'session', projectId, id, draft, origin }),
    };
    return <SessionPinsProvider projects={PROJECTS}><SidebarContent {...props} /></SessionPinsProvider>;
  }
  render(<RenameHarness />);
  await waitFor(() => assert.deepEqual(pinnedIds(screen.getByTestId('project-session-tree')), ['a']));
  const list = screen.getByTestId(listTestId);
  fireEvent.click(within(list).getByRole('button', { name: 'Session options for Title a' }));
  fireEvent.click(await screen.findByRole('menuitem', { name: 'Rename session' }));
  assert.equal(screen.getAllByRole('textbox').length, 1);
  assert.ok(within(list).getByRole('textbox'));
});

test('a pinned session that is also active shows only under Pinned, which counts it as needing a reply', async () => {
  // Ids of their own: Active remembers sessions for the page load, i.e. across tests here.
  const both = conversation('pinned-and-active'), onlyActive = conversation('only-active');
  const projects: Project[] = [{ ...PROJECTS[0], sessions: [
    { id: both.sessionId, summary: both.sessionTitle, __provider: 'codex' },
    { id: onlyActive.sessionId, summary: onlyActive.sessionTitle, __provider: 'codex' },
  ] }];
  mocks.load.mockResolvedValue(response([both]));
  const props = contentProps('projects');
  props.projectListProps = { ...listProps, projects, filteredProjects: projects,
    activeSessions: new Set([both.sessionId, onlyActive.sessionId]), attentionSessionIds: new Set([both.sessionId]) };
  render(<SessionPinsProvider projects={projects}><SidebarContent {...props} /></SessionPinsProvider>);
  const pinned = await screen.findByTestId('pinned-sessions-section');
  assert.ok(within(pinned).getByText(both.sessionTitle));
  assert.ok(within(pinned).getByText(/needs reply/));
  const active = screen.getByTestId('active-conversations-list');
  assert.equal(within(active).queryByText(both.sessionTitle), null);
  assert.ok(within(active).getByText(onlyActive.sessionTitle));
});

test('search and archived views do not show unrelated pinned shortcuts', async () => {
  const props = contentProps('conversations');
  const { rerender } = render(<SessionPinsProvider projects={PROJECTS}><SidebarContent {...props} searchFilter="x" /></SessionPinsProvider>);
  fireEvent.click(screen.getByRole('button', { name: 'Session options for Title a' }));
  const unpin = await screen.findByRole('menuitem', { name: 'Unpin session' });
  await waitFor(() => assert.equal(unpin.hasAttribute('disabled'), false));
  assert.equal(Boolean(screen.queryByTestId('pinned-sessions-section')), false);
  assert.ok(within(screen.getByTestId('recent-conversations-list')).getByText('Title a'), 'a one-character query must not hide pins when recents is still visible');
  rerender(<SessionPinsProvider projects={PROJECTS}><SidebarContent {...props} searchMode="archived" /></SessionPinsProvider>);
  assert.equal(Boolean(screen.queryByTestId('pinned-sessions-section')), false);
});

test('pins outside the loaded recent page still render; loading older conversations keeps its pagination callback', async () => {
  const props = contentProps('conversations');
  props.recentConversations = [B];
  props.recentConversationsHasMore = true;
  const more = vi.fn();
  props.onLoadMoreRecentConversations = more;
  render(<SessionPinsProvider projects={EMPTY_PROJECTS}><SidebarContent {...props} /></SessionPinsProvider>);
  await waitFor(() => assert.ok(screen.queryByTestId('pinned-sessions-section')));
  assert.ok(screen.getByText('Title a'));
  fireEvent.click(screen.getByRole('button', { name: 'Load older conversations' }));
  assert.equal(more.mock.calls.length, 1);
});

test('an older in-flight refresh cannot reinsert a session after unpin', async () => {
  const { result } = renderHook(() => useSessionPins(), { wrapper });
  await waitFor(() => assert.equal(result.current?.ready, true));
  const stale = deferred<ReturnType<typeof response>>();
  mocks.load.mockReturnValueOnce(stale.promise);
  let oldRead!: Promise<void>;
  act(() => { oldRead = result.current!.refresh(); });
  await act(async () => { await result.current!.setPinned('a', false); });
  await act(async () => { stale.resolve(response([A])); await oldRead; });
  assert.deepEqual(result.current?.sessions, []);
});

test('a failed save keeps the original pin and exposes a retryable error', async () => {
  vi.spyOn(console, 'error').mockImplementation(noop);
  mocks.save.mockRejectedValue(new Error('offline'));
  const { result } = renderHook(() => useSessionPins(), { wrapper });
  await waitFor(() => assert.equal(result.current?.ready, true));
  await act(async () => { await result.current!.setPinned('a', false); });
  assert.equal(result.current?.pinnedIds.has('a'), true);
  assert.equal(result.current?.hasError, true);
  assert.equal(result.current?.pendingSessionId, null);
  await act(async () => { await result.current!.refresh(); });
  assert.equal(result.current?.hasError, false);
});

test('a failed initial load shows a retry control even with no pinned sessions', async () => {
  vi.spyOn(console, 'error').mockImplementation(noop);
  mocks.load.mockRejectedValueOnce(new Error('offline'));
  render(<SessionPinsProvider projects={PROJECTS}><SidebarContent {...contentProps('projects')} /></SessionPinsProvider>);
  await waitFor(() => assert.ok(screen.queryByRole('alert')));
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  await waitFor(() => assert.equal(Boolean(screen.queryByRole('alert')), false));
  assert.deepEqual(pinnedIds(screen.getByTestId('project-session-tree')), ['a']);
  assert.ok(within(screen.getByTestId('pinned-sessions-section')).getByText('Title a'));
});

test('double taps serialize mutations and a focus refresh picks up another device\'s pins', async () => {
  const { result } = renderHook(() => useSessionPins(), { wrapper });
  await waitFor(() => assert.equal(result.current?.ready, true));
  const save = deferred<ReturnType<typeof response>>();
  mocks.save.mockReturnValueOnce(save.promise);
  let first!: Promise<void>;
  act(() => { first = result.current!.setPinned('a', false); void result.current!.setPinned('a', false); });
  assert.equal(mocks.save.mock.calls.length, 1);
  assert.equal(result.current?.pendingSessionId, 'a');
  await act(async () => { save.resolve(response([])); await first; });
  mocks.load.mockResolvedValue(response([B]));
  fireEvent(window, new Event('focus'));
  await waitFor(() => assert.deepEqual(result.current?.sessions, [B]));
});

test('standalone recent rows retain their existing controls without a pin provider', () => {
  render(<SidebarRecentConversations conversations={[A]} total={1} hasMore={false} isLoading={false}
    isLoadingMore={false} hasError={false} selectedSession={null} currentTime={NOW} sessionActions={actions}
    onConversationSelect={noop} onLoadMore={noop} onRetry={noop} t={t} />);
  assert.ok(screen.getByText('Title a'));
  assert.equal(Boolean(screen.queryByRole('button', { name: 'Pin session: Title a' })), false);
});


test('an off-page pinned child supplies ancestry without a loaded descendant and keeps loaded metadata authoritative', async () => {
  const projects: Project[] = [{ ...PROJECTS[0], sessions: [
    { id: 'newest', summary: 'Newest', __provider: 'codex' },
    { id: 'a', summary: 'Current parent title', __provider: 'codex' },
  ], sessionMeta: { total: 30, hasMore: true } }];
  const child = { ...B, forkedFromSessionId: 'a', forkAncestors: [
    { id: 'a', summary: 'Stale parent title', provider: 'codex' as const, forkedFromSessionId: null },
  ] };
  mocks.load.mockResolvedValue(response([child]));
  const props = contentProps('projects');
  props.projectListProps = { ...listProps, projects, filteredProjects: projects };
  render(<SessionPinsProvider projects={projects}><SidebarContent {...props} /></SessionPinsProvider>);
  const tree = screen.getByTestId('project-session-tree');
  await waitFor(() => assert.deepEqual(pinnedIds(tree), ['b']));
  assert.deepEqual([...tree.querySelectorAll('[data-session-id]')].map((row) => [
    row.getAttribute('data-session-id'), row.getAttribute('data-parent-session-id'), row.getAttribute('data-fork-depth'),
  ]), [['a', null, '0'], ['b', 'a', '1'], ['newest', null, '0']]);
  assert.ok(screen.getByText('Current parent title'));
  assert.equal(Boolean(screen.queryByText('Stale parent title')), false);
});


test('polls coalesce behind a slow initial read instead of starving pin readiness', async () => {
  vi.useFakeTimers();
  const read = deferred<ReturnType<typeof response>>();
  mocks.load.mockReturnValue(read.promise);
  const { result, unmount } = renderHook(() => useSessionPins(), { wrapper });
  try {
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    await act(async () => { await vi.advanceTimersByTimeAsync(11_000); });
    assert.equal(mocks.load.mock.calls.length, 1);
    await act(async () => { read.resolve(response([A])); });
    assert.equal(result.current?.ready, true);
    assert.deepEqual(result.current?.sessions, [A]);
  } finally { unmount(); vi.useRealTimers(); }
});

test('a timed-out save clears pending state and permits a subsequent explicit save', async () => {
  vi.useFakeTimers();
  vi.spyOn(console, 'error').mockImplementation(noop);
  mocks.save.mockImplementationOnce((_id, _pinned, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(new DOMException('Timed out', 'AbortError')), { once: true });
  }));
  const { result, unmount } = renderHook(() => useSessionPins(), { wrapper });
  try {
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    assert.equal(result.current?.ready, true);
    let save!: Promise<void>;
    act(() => { save = result.current!.setPinned('a', false); });
    assert.equal(result.current?.pendingSessionId, 'a');
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); await save; });
    assert.equal(result.current?.pendingSessionId, null);
    assert.equal(result.current?.hasError, true);
    assert.equal(result.current?.pinnedIds.has('a'), true);
    await act(async () => { await result.current!.setPinned('a', false); });
    assert.equal(result.current?.hasError, false);
    assert.equal(result.current?.pinnedIds.has('a'), false);
    assert.equal(mocks.save.mock.calls.length, 2);
  } finally { unmount(); vi.useRealTimers(); }
});
