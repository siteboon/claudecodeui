import assert from 'node:assert/strict';

import { act, renderHook } from '@testing-library/react';
import type { TFunction } from 'i18next';
import { afterEach, beforeEach, test, vi } from 'vitest';

import type { Project } from '@/shared/types';

/**
 * "Load more sessions" under a project (#1598). The click handler used to learn
 * whether to fetch from a flag it set inside a state updater. React runs an
 * updater inside the setter call only while the component has no render work
 * left over; once the sidebar has re-rendered from its own state (typing in the
 * filter, its once-a-minute clock), the updater waits for the next render, the
 * flag is still unset when read, and the click sends nothing while the button
 * sticks on "Loading sessions...". These tests re-render the sidebar from its
 * own state first, the way the app does, before every click.
 */

vi.mock('@/shared/api', () => ({
  api: {
    archivedProjects: () => Promise.resolve({ ok: true, json: async () => ({ data: { projects: [] } }) }),
    getArchivedSessions: () => Promise.resolve({ ok: true, json: async () => ({ data: { sessions: [] } }) }),
    recentConversations: () => Promise.resolve({ ok: true, json: async () => ({ data: { conversations: [] } }) }),
  },
}));

const { useSidebarController } = await import('@/modules/sidebar/hooks/useSidebarController');

const t = ((key: string) => key) as unknown as TFunction;
const alertMock = vi.fn();

const buildProject = (projectId: string): Project => ({
  projectId,
  path: `/${projectId}`,
  fullPath: `/${projectId}`,
  displayName: projectId,
  isStarred: false,
  sessions: Array.from({ length: 20 }, (_, index) => ({ id: `${projectId}-s${index}`, __provider: 'claude' as const })),
  sessionMeta: { hasMore: true, total: 45 },
});

const PROJECTS = [buildProject('project-1'), buildProject('project-2')];

const renderController = (onLoadMoreSessions: (projectId: string) => Promise<void>) => renderHook(() => useSidebarController({
  projects: PROJECTS,
  selectedProject: null,
  selectedSession: null,
  activeSessions: new Set<string>(),
  backgroundSessionIds: new Set<string>(),
  isLoading: false,
  isMobile: false,
  t,
  onRefresh: vi.fn(),
  onProjectSelect: vi.fn(),
  onSessionSelect: vi.fn(),
  onLoadMoreSessions,
  setCurrentProject: vi.fn(),
  setSidebarVisible: vi.fn(),
  sidebarVisible: true,
}));

type Controller = ReturnType<typeof renderController>['result'];

/** A page request the test settles by hand, to look at the sidebar while it is in flight. */
const pendingPage = () => {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((settle, fail) => {
    resolve = settle;
    reject = fail;
  });
  // A rejection nobody awaited (the click never asked for the page) must fail
  // the assertions, not surface as an unhandled rejection.
  promise.catch(() => {});
  return { promise, resolve, reject };
};

/** Mounts the sidebar, lets its mount fetches land, then re-renders it from its own state. */
const renderAfterOwnRerender = async (onLoadMoreSessions: (projectId: string) => Promise<void>) => {
  const rendered = renderController(onLoadMoreSessions);
  await act(async () => {});
  act(() => {
    rendered.result.current.setSearchFilter('project');
  });
  return rendered;
};

/** Clicks "Load more sessions" for one project and hands back the click's own promise. */
const clickLoadMore = (result: Controller, projectId: string): Promise<void> => {
  let loading: Promise<void> = Promise.resolve();
  act(() => {
    loading = result.current.loadMoreSessionsForProject(projectId);
  });
  return loading;
};

beforeEach(() => {
  localStorage.clear();
  alertMock.mockReset();
  vi.stubGlobal('alert', alertMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

test('a click after the sidebar re-rendered from its own state fetches the next page', async () => {
  const page = pendingPage();
  const onLoadMoreSessions = vi.fn(() => page.promise);
  const { result } = await renderAfterOwnRerender(onLoadMoreSessions);

  const loading = clickLoadMore(result, 'project-1');

  assert.deepEqual(onLoadMoreSessions.mock.calls, [['project-1']], 'the click asked for the next page');
  assert.equal(result.current.loadingMoreProjects.has('project-1'), true, 'the button shows its loading state');

  await act(async () => {
    page.resolve();
    await loading;
  });

  assert.equal(result.current.loadingMoreProjects.has('project-1'), false, 'the button is clickable again');
});

test('clicking again while the page loads sends nothing more, and the next click after it does', async () => {
  const firstPage = pendingPage();
  const onLoadMoreSessions = vi.fn<(projectId: string) => Promise<void>>(() => firstPage.promise);
  const { result } = await renderAfterOwnRerender(onLoadMoreSessions);

  // A double click: both land before React has re-rendered and disabled the button.
  let firstLoading: Promise<void> = Promise.resolve();
  act(() => {
    firstLoading = result.current.loadMoreSessionsForProject('project-1');
    void result.current.loadMoreSessionsForProject('project-1');
  });
  void clickLoadMore(result, 'project-1');

  assert.equal(onLoadMoreSessions.mock.calls.length, 1, 'one request for one page');

  await act(async () => {
    firstPage.resolve();
    await firstLoading;
  });

  onLoadMoreSessions.mockImplementation(() => Promise.resolve());
  await act(async () => {
    await clickLoadMore(result, 'project-1');
  });

  assert.equal(onLoadMoreSessions.mock.calls.length, 2, 'the following page is fetched on the next click');
});

test('a failed page says so and leaves the button ready to retry', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const page = pendingPage();
  const onLoadMoreSessions = vi.fn<(projectId: string) => Promise<void>>(() => page.promise);
  const { result } = await renderAfterOwnRerender(onLoadMoreSessions);

  const loading = clickLoadMore(result, 'project-1');
  await act(async () => {
    page.reject(new Error('offline'));
    await loading;
  });

  assert.deepEqual(alertMock.mock.calls, [['messages.refreshError']]);
  assert.equal(result.current.loadingMoreProjects.has('project-1'), false, 'the button left its loading state');

  onLoadMoreSessions.mockImplementation(() => Promise.resolve());
  await act(async () => {
    await clickLoadMore(result, 'project-1');
  });

  assert.equal(onLoadMoreSessions.mock.calls.length, 2, 'the retry was sent');
});

test('one project loading does not hold back another, and finishing one leaves the other loading', async () => {
  const firstPage = pendingPage();
  const secondPage = pendingPage();
  const onLoadMoreSessions = vi.fn((projectId: string) => (
    projectId === 'project-1' ? firstPage.promise : secondPage.promise
  ));
  const { result } = await renderAfterOwnRerender(onLoadMoreSessions);

  const firstLoading = clickLoadMore(result, 'project-1');
  const secondLoading = clickLoadMore(result, 'project-2');

  assert.deepEqual(onLoadMoreSessions.mock.calls, [['project-1'], ['project-2']]);
  assert.deepEqual([...result.current.loadingMoreProjects].sort(), ['project-1', 'project-2']);

  await act(async () => {
    firstPage.resolve();
    await firstLoading;
  });

  assert.deepEqual([...result.current.loadingMoreProjects], ['project-2'], 'project-2 still shows its loading state');
  void clickLoadMore(result, 'project-2');
  assert.equal(onLoadMoreSessions.mock.calls.length, 2, 'project-2 is still guarded while its page loads');

  await act(async () => {
    secondPage.resolve();
    await secondLoading;
  });

  assert.equal(result.current.loadingMoreProjects.size, 0);
});
