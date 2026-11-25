import assert from 'node:assert/strict';

import { fireEvent, render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import type { TFunction } from 'i18next';
import { test, vi } from 'vitest';

import SidebarProjectSessions from '@/modules/sidebar/SidebarProjectSessions';
import SidebarRecentConversations from '@/modules/sidebar/SidebarRecentConversations';
import type { SessionWithProvider } from '@/shared/types';

vi.mock('@/shared/hooks/useProviderCapabilities', () => ({ useSessionForkingProviders: () => new Set(['claude', 'codex']) }));
const optionsProps = vi.hoisted(() => [] as Record<string, unknown>[]);
vi.mock('@/modules/sidebar/SessionOptions', () => ({ default: (props: Record<string, unknown>) => { optionsProps.push(props); return null; } }));

const t = ((key: string, options?: { session?: string }) => options?.session ? `${key} ${options.session}` : key) as TFunction;
const noop = () => {};
const root: SessionWithProvider = { id: 'root', summary: 'Original', __provider: 'claude' };
const child: SessionWithProvider = { id: 'child', summary: 'Alternative', __provider: 'claude', forkedFromSessionId: 'root' };
const leaf: SessionWithProvider = { id: 'leaf', summary: 'Experiment', __provider: 'claude', forkedFromSessionId: 'child' };
const unrelated: SessionWithProvider = { id: 'unrelated', summary: 'Other', __provider: 'codex' };
const sessions = [leaf, unrelated, child, root];

const props = (overrides: Partial<ComponentProps<typeof SidebarProjectSessions>> = {}): ComponentProps<typeof SidebarProjectSessions> => ({
  project: { projectId: 'project', displayName: 'Project', fullPath: '/workspace/project' },
  isExpanded: true, sessions, selectedSession: null, initialSessionsLoaded: true,
  hasMoreSessions: false, isLoadingMoreSessions: false,
  activeSessions: new Set(), backgroundSessionIds: new Set(), attentionSessionIds: new Set(),
  currentTime: new Date('2026-10-18T00:00:00Z'), sessionRenameId: null, sessionRenameDraft: '',
  onRenameDraftChange: noop, onStartEditingSession: noop, onCancelEditingSession: noop,
  onSaveEditingSession: noop, onSessionSelect: noop, onArchiveSession: noop, onDeleteSession: noop,
  onForkSession: noop, onLoadMoreSessions: noop, selectedSessionIds: null,
  onSetSessionSelection: noop, onToggleSessionSelected: noop, onCancelSessionSelection: noop,
  onDeleteSelectedSessions: noop, t, ...overrides,
});
const rowIds = (container: HTMLElement) => Array.from(container.querySelectorAll('[data-session-id]')).map((row) => row.getAttribute('data-session-id'));

test('Projects nests forks and preserves row actions', () => {
  const select = vi.fn();
  const { container } = render(<SidebarProjectSessions {...props({ onSessionSelect: select })} />);
  assert.deepEqual(rowIds(container), ['root', 'child', 'leaf', 'unrelated']);
  assert.equal(container.querySelector('[data-session-id="leaf"]')?.getAttribute('data-fork-depth'), '2');
  assert.equal(container.querySelector('[data-session-id="child"]')?.getAttribute('data-parent-session-id'), 'root');
  assert.equal(container.querySelector('[data-session-id="root"]')?.getAttribute('data-fork-branch'), 'true');
  assert.equal(container.querySelector('[data-session-id="child"]')?.getAttribute('data-fork-branch'), 'true');
  assert.equal(container.querySelector('[data-session-id="leaf"]')?.getAttribute('data-fork-branch'), null);

  fireEvent.click(screen.getByText('Experiment'));
  assert.deepEqual(select.mock.calls, [[leaf, 'project']]);
  select.mockClear();
  const collapse = screen.getByRole('button', { name: 'sessions.collapseForks Original' });
  fireEvent.click(collapse);
  assert.deepEqual(rowIds(container), ['root', 'unrelated']);
  assert.equal(select.mock.calls.length, 0);
  assert.equal(collapse.getAttribute('aria-expanded'), 'false');
  fireEvent.click(screen.getByRole('button', { name: 'sessions.expandForks Original' }));
  assert.deepEqual(rowIds(container), ['root', 'child', 'leaf', 'unrelated']);
});

test.each([root, leaf])('the fork tree gives $id, loaded or an off-page ancestor, options for itself', (session) => {
  optionsProps.length = 0;
  render(<SidebarProjectSessions {...props({ sessions: [{ ...leaf, forkAncestors: [child, root] }] })} />);

  const options = optionsProps.filter((entry) => entry.sessionId === session.id);
  assert.ok(options.length > 0);
  assert.equal(options.at(-1)?.sessionName, session.summary);
  assert.equal(options.at(-1)?.projectId, 'project');
});

test('fork connectors identify siblings and terminate the family', () => {
  const second = { ...child, id: 'second', summary: 'Second fork', forkedFromSessionId: 'root' };
  const last = { ...second, id: 'last', summary: 'Last fork' };
  const initial = props({ sessions: [leaf, second, last, child, root, unrelated] });
  const { container, rerender } = render(<SidebarProjectSessions {...initial} />);
  const row = (id: string) => container.querySelector(`[data-session-id="${id}"]`)!;
  const connector = (id: string) => row(id).querySelector('[data-fork-connector]')?.getAttribute('data-fork-connector');

  assert.deepEqual(rowIds(container), ['root', 'child', 'leaf', 'second', 'last', 'unrelated']);
  assert.equal(connector('root'), undefined);
  assert.equal(connector('child'), 'branch');
  assert.equal(connector('second'), 'branch');
  assert.equal(connector('last'), 'last');
  assert.equal(connector('leaf'), 'last');
  assert.ok(row('leaf').querySelector('[data-fork-continuation="1"]'), 'the root rail continues through nested descendants to its remaining children');
  assert.equal(row('unrelated').querySelector('[data-fork-continuation]'), null);

  fireEvent.click(screen.getByRole('button', { name: 'sessions.collapseForks Alternative' }));
  assert.equal(row('child').querySelector('[data-fork-stem]'), null);
  assert.equal(connector('child'), 'branch');
  assert.equal(connector('last'), 'last');

  rerender(<SidebarProjectSessions {...initial} sessions={initial.sessions.filter((session) => session.id !== 'last')} />);
  assert.equal(connector('second'), 'last', 'removing the last fork terminates the line at its previous sibling');
  fireEvent.click(screen.getByRole('button', { name: 'sessions.collapseForks Original' }));
  assert.deepEqual(rowIds(container), ['root', 'unrelated']);
  assert.equal(container.querySelector('[data-fork-connector]'), null);
  assert.equal(container.querySelector('[data-fork-stem]'), null);
});

test('selecting or renaming a hidden descendant opens its complete ancestry', () => {
  const initial = props();
  const { container, rerender } = render(<SidebarProjectSessions {...initial} />);
  fireEvent.click(screen.getByRole('button', { name: 'sessions.collapseForks Alternative' }));
  fireEvent.click(screen.getByRole('button', { name: 'sessions.collapseForks Original' }));
  rerender(<SidebarProjectSessions {...initial} selectedSession={leaf} />);
  assert.deepEqual(rowIds(container), ['root', 'child', 'leaf', 'unrelated']);
  fireEvent.click(screen.getByRole('button', { name: 'sessions.collapseForks Original' }));
  rerender(<SidebarProjectSessions {...initial} selectedSession={leaf} sessionRenameId="leaf" />);
  assert.ok(container.querySelector('[data-session-id="leaf"]'));
});

test('an off-page source is shown once, and a newly selected fork opens its collapsed source', () => {
  const initial = props({ sessions: [child, root] });
  const { container, rerender } = render(<SidebarProjectSessions {...initial} />);
  fireEvent.click(screen.getByRole('button', { name: 'sessions.collapseForks Original' }));
  const fork = { ...leaf, forkAncestors: [child, root] };
  rerender(<SidebarProjectSessions {...initial} sessions={[fork]} selectedSession={fork} hasMoreSessions />);
  assert.deepEqual(rowIds(container), ['root', 'child', 'leaf']);
  const loadMore = screen.getByRole('button', { name: 'Load more sessions' });
  assert.ok(loadMore);
});

test('live activity and title updates preserve a user collapse around the selected fork', () => {
  const initial = props({ selectedSession: leaf });
  const { container, rerender } = render(<SidebarProjectSessions {...initial} />);
  fireEvent.click(screen.getByRole('button', { name: 'sessions.collapseForks Original' }));
  rerender(<SidebarProjectSessions {...initial} sessions={sessions.map((session) => session.id === 'leaf'
    ? { ...session, summary: 'Updated experiment', lastActivity: new Date().toISOString() }
    : session)} />);
  assert.deepEqual(rowIds(container), ['root', 'unrelated']);
});

test('bulk selection includes displayed ancestor context and hidden forks, excluding responding sessions', () => {
  const onSetSessionSelection = vi.fn();
  render(<SidebarProjectSessions {...props({
    sessions: [{ ...leaf, forkAncestors: [child, root] }], selectedSessionIds: new Set(),
    activeSessions: new Set(['child']), onSetSessionSelection, hasMoreSessions: true,
  })} />);
  fireEvent.click(screen.getByRole('button', { name: 'sessions.selectAllLoaded' }));
  assert.deepEqual([...onSetSessionSelection.mock.calls[0][0].sessionIds], ['root', 'leaf']);
});

test('Conversations stays flat and newest first even when sessions have fork metadata', () => {
  const conversations = [child, unrelated, root].map((session) => ({
    ...session, sessionId: session.id, provider: session.__provider, projectId: 'project',
    projectDisplayName: 'Project', sessionTitle: session.summary!, lastActivity: null,
  }));
  const { container } = render(<SidebarRecentConversations
    conversations={conversations} total={3} hasMore={false} isLoading={false} isLoadingMore={false} hasError={false}
    selectedSession={null} currentTime={new Date()} t={t}
    sessionActions={{
      activeSessions: new Set(), backgroundSessionIds: new Set(), attentionSessionIds: new Set(),
      activeRename: null, onRenameDraftChange: noop, onStartEditingSession: noop,
      onCancelEditingSession: noop, onSaveEditingSession: noop, onArchiveSession: noop, onDeleteSession: noop,
    }} onConversationSelect={noop} onLoadMore={noop} onRetry={noop}
  />);
  assert.deepEqual(Array.from(container.querySelectorAll('[data-testid="recent-conversation-row"]')).map((row) => row.getAttribute('href')),
    ['/session/child', '/session/unrelated', '/session/root']);
  assert.equal(container.querySelector('[data-testid="project-session-tree"]'), null);
  assert.equal(container.querySelector('[aria-expanded]'), null);
});
