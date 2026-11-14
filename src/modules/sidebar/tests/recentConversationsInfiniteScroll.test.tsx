import assert from 'node:assert/strict';

import { act, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, test, vi } from 'vitest';

import type { RecentConversationListItem, SessionRowActions, SidebarProjectListProps } from '@/shared/types';

/**
 * Scrolling the Conversations list to its end loads the next page. jsdom has
 * no IntersectionObserver, so these tests install a stand-in and report the
 * sentinel as visible by hand.
 */

vi.mock('@/modules/sidebar/SessionOptions', () => ({
  default: () => null,
}));

const { default: SidebarRecentConversations } = await import('@/modules/sidebar/SidebarRecentConversations');

class StubIntersectionObserver {
  static instances: StubIntersectionObserver[] = [];

  callback: IntersectionObserverCallback;
  observed: Element[] = [];

  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback;
    StubIntersectionObserver.instances.push(this);
  }

  observe(element: Element): void {
    this.observed.push(element);
  }

  unobserve(element: Element): void {
    this.observed = this.observed.filter((observed) => observed !== element);
  }

  disconnect(): void {
    this.observed = [];
  }
}

/** Reports every element still observed by a live observer as in (or out of) view. */
function scrollSentinelIntoView(isIntersecting = true): void {
  act(() => {
    for (const observer of [...StubIntersectionObserver.instances]) {
      for (const target of [...observer.observed]) {
        observer.callback(
          [{ target, isIntersecting } as IntersectionObserverEntry],
          observer as unknown as IntersectionObserver,
        );
      }
    }
  });
}

const t = ((key: string, fallback?: string) => fallback ?? key) as unknown as SidebarProjectListProps['t'];
const NOW = new Date('2026-08-21T10:00:00.000Z');
const noop = () => {};

const conversations = (count: number): RecentConversationListItem[] =>
  Array.from({ length: count }, (_, index) => ({
    sessionId: `s${index}`,
    provider: 'claude',
    projectId: 'project-1',
    projectDisplayName: 'project one',
    sessionTitle: `title ${index}`,
    lastActivity: '2026-08-21T09:30:00.000Z',
  }));

const sessionActions: SessionRowActions = {
  activeRename: null,
  activeSessions: new Set<string>(),
  backgroundSessionIds: new Set<string>(),
  attentionSessionIds: new Set<string>(),
  onRenameDraftChange: noop,
  onStartEditingSession: noop,
  onCancelEditingSession: noop,
  onSaveEditingSession: noop,
  onArchiveSession: noop,
  onDeleteSession: noop,
};

type ListState = {
  items: RecentConversationListItem[];
  hasMore?: boolean;
  isLoading?: boolean;
  isLoadingMore?: boolean;
  hasError?: boolean;
};

function renderList(state: ListState, onLoadMore: () => void) {
  const element = (next: ListState) => (
    <SidebarRecentConversations
      conversations={next.items}
      total={100}
      hasMore={next.hasMore ?? true}
      isLoading={next.isLoading ?? false}
      isLoadingMore={next.isLoadingMore ?? false}
      hasError={next.hasError ?? false}
      selectedSession={null}
      currentTime={NOW}
      sessionActions={sessionActions}
      onConversationSelect={noop}
      onLoadMore={onLoadMore}
      onRetry={noop}
      t={t}
    />
  );
  const view = render(element(state));
  return { rerender: (next: ListState) => view.rerender(element(next)) };
}

beforeEach(() => {
  StubIntersectionObserver.instances = [];
  vi.stubGlobal('IntersectionObserver', StubIntersectionObserver);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

test('reaching the end of the list loads the next page once', () => {
  const onLoadMore = vi.fn();
  renderList({ items: conversations(40) }, onLoadMore);

  scrollSentinelIntoView(false);
  assert.equal(onLoadMore.mock.calls.length, 0);

  scrollSentinelIntoView();
  assert.equal(onLoadMore.mock.calls.length, 1);

  // The observer stops after firing: staying in view does not request again.
  scrollSentinelIntoView();
  assert.equal(onLoadMore.mock.calls.length, 1);
});

test('after a page arrives, a still-visible end loads the following page', () => {
  const onLoadMore = vi.fn();
  const { rerender } = renderList({ items: conversations(40) }, onLoadMore);

  scrollSentinelIntoView();
  rerender({ items: conversations(40), isLoadingMore: true });
  scrollSentinelIntoView();
  assert.equal(onLoadMore.mock.calls.length, 1, 'no request while a page is loading');

  rerender({ items: conversations(80) });
  scrollSentinelIntoView();
  assert.equal(onLoadMore.mock.calls.length, 2);
});

test('a page that adds nothing stops the automatic loading', () => {
  const onLoadMore = vi.fn();
  const { rerender } = renderList({ items: conversations(40) }, onLoadMore);

  scrollSentinelIntoView();
  rerender({ items: conversations(40), isLoadingMore: true });
  rerender({ items: conversations(40) });
  scrollSentinelIntoView();
  assert.equal(onLoadMore.mock.calls.length, 1);

  // The button still loads by hand.
  fireEvent.click(screen.getByText('Load older conversations'));
  assert.equal(onLoadMore.mock.calls.length, 2);
});

test('a full reload re-enables loading at a length that had stopped', () => {
  const onLoadMore = vi.fn();
  const { rerender } = renderList({ items: conversations(40) }, onLoadMore);

  scrollSentinelIntoView();
  rerender({ items: conversations(40) });
  scrollSentinelIntoView();
  assert.equal(onLoadMore.mock.calls.length, 1);

  rerender({ items: [], isLoading: true });
  rerender({ items: conversations(40) });
  scrollSentinelIntoView();
  assert.equal(onLoadMore.mock.calls.length, 2);
});

test('no automatic request while a full reload keeps the old rows on screen', () => {
  const onLoadMore = vi.fn();
  const { rerender } = renderList({ items: conversations(40), isLoading: true }, onLoadMore);

  scrollSentinelIntoView();
  assert.equal(onLoadMore.mock.calls.length, 0, 'no request during the reload');
  assert.ok(screen.getByText('title 0'), 'existing rows stay visible');

  // The reload returns the same number of rows; scrolling still works after it.
  rerender({ items: conversations(40) });
  scrollSentinelIntoView();
  assert.equal(onLoadMore.mock.calls.length, 1);
});

test('no automatic request after an error or when everything is loaded', () => {
  const onLoadMore = vi.fn();
  const { rerender } = renderList({ items: conversations(40), hasError: true }, onLoadMore);
  scrollSentinelIntoView();

  rerender({ items: conversations(40), hasMore: false });
  scrollSentinelIntoView();

  assert.equal(onLoadMore.mock.calls.length, 0);
  assert.equal(screen.queryByTestId('recent-conversations-load-more'), null);
});

test('without IntersectionObserver the list keeps the load button', () => {
  vi.stubGlobal('IntersectionObserver', undefined);

  const onLoadMore = vi.fn();
  renderList({ items: conversations(40) }, onLoadMore);
  assert.equal(onLoadMore.mock.calls.length, 0);

  fireEvent.click(screen.getByText('Load older conversations'));
  assert.equal(onLoadMore.mock.calls.length, 1);
});
