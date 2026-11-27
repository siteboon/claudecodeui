import assert from 'node:assert/strict';

import type { TFunction } from 'i18next';
import { beforeEach, test, vi } from 'vitest';

import type { Project, ProjectSession, SidebarProjectListProps } from '@/shared/types';
import type { getActiveConversations as GetActiveConversations } from '@/modules/sidebar/utils/activeConversations';

/**
 * Active lists sessions running, waiting on the user or used within the last
 * hour. It never reorders or shrinks while the page is open: rows join at the
 * top as they become active and only leave on a reload.
 */

const t = ((key: string) => key) as unknown as TFunction;
const NOW = new Date('2026-11-25T12:00:00Z');
const minutesAgo = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000).toISOString();
const session = (id: string, lastActivity: string): ProjectSession => ({ id, summary: id, lastActivity, __provider: 'claude' });

const listProps = (sessions: ProjectSession[], overrides: Partial<SidebarProjectListProps> = {}) => ({
  projects: [{ projectId: 'p1', displayName: 'One', fullPath: '/one', sessions } as Project],
  getProjectSessions: (project: Project) => project.sessions ?? [],
  activeSessions: new Set<string>(),
  attentionSessionIds: new Set<string>(),
  currentTime: NOW,
  ...overrides,
}) as unknown as SidebarProjectListProps;

let getActiveConversations: typeof GetActiveConversations;

beforeEach(async () => {
  // The joined-at memory lives for a page load; a fresh module is a fresh load.
  vi.resetModules();
  ({ getActiveConversations } = await import('@/modules/sidebar/utils/activeConversations'));
});

const ids = (props: SidebarProjectListProps) => getActiveConversations(props, t).map((row) => row.sessionId);

test('running, waiting and last-hour sessions are active; older idle ones are not', () => {
  const sessions = [session('recent', minutesAgo(30)), session('old', minutesAgo(90)), session('running', minutesAgo(300)), session('waiting', minutesAgo(300))];
  const props = listProps(sessions, { activeSessions: new Set(['running']), attentionSessionIds: new Set(['waiting']) });

  assert.deepEqual(ids(props).sort(), ['recent', 'running', 'waiting']);
});

test('a session that becomes active joins at the top, and nothing leaves until reload', () => {
  const sessions = [session('a', minutesAgo(10)), session('b', minutesAgo(20)), session('c', minutesAgo(600))];
  assert.deepEqual(ids(listProps(sessions)), ['a', 'b']);

  // An hour later 'a' and 'b' are past the window, and 'c' starts running.
  const later = new Date(NOW.getTime() + 60 * 60_000);
  assert.deepEqual(ids(listProps(sessions, { currentTime: later, activeSessions: new Set(['c']) })), ['c', 'a', 'b']);
});

test('new activity on a row that joined with others never moves it', () => {
  const props = (b: ProjectSession) => listProps([session('a', minutesAgo(5)), b]);
  assert.deepEqual(ids(props(session('b', minutesAgo(10)))), ['a', 'b']);

  assert.deepEqual(ids(props(session('b', minutesAgo(0)))), ['a', 'b']);
});
