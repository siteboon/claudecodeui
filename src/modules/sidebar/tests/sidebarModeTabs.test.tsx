import assert from 'node:assert/strict';

import { fireEvent, render, screen } from '@testing-library/react';
import type { TFunction } from 'i18next';
import { beforeEach, test, vi } from 'vitest';

import type { SidebarSearchMode } from '@/shared/types';
import SidebarModeTabs from '@/modules/sidebar/SidebarModeTabs';

/**
 * The strip has to survive a sidebar dragged down to its 220px minimum. jsdom
 * does no layout, so widths are stubbed: the row reports the width under test
 * and every other element a width derived from its label, which is enough for
 * the component to split the tabs the way a browser would.
 */

const LABELS: Record<string, string> = {
  'search.modeProjects': 'Projects',
  'search.modeConversations': 'Conversations',
  'search.runningTooltip': 'Running sessions',
  'search.archiveOnlyTooltip': 'Archive only',
  'search.modeMore': 'More',
};

type TranslateOptions = { defaultValue?: string; tab?: string; count?: number };

const interpolate = (template: string, options?: TranslateOptions): string => (
  template
    .replace('{{tab}}', options?.tab ?? '')
    .replace('{{count}}', options?.count !== undefined ? String(options.count) : '')
);

const t = ((key: string, fallback?: string | TranslateOptions) => {
  const fallbackText = typeof fallback === 'string' ? fallback : fallback?.defaultValue;
  const raw = LABELS[key] ?? fallbackText ?? key;
  return typeof fallback === 'object' && fallback !== null ? interpolate(raw, fallback) : raw;
}) as unknown as TFunction;

const awaitingInput = vi.hoisted(() => ({ sessionIds: new Set<string>() }));

vi.mock('@/shared/context/PermissionAttentionContext', () => ({
  useAwaitingInputSessionIdSet: () => awaitingInput.sessionIds,
}));

beforeEach(() => {
  awaitingInput.sessionIds.clear();
});

const stubLayout = (rowWidth: number) => {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function measure(this: HTMLElement) {
    // The row is the only `relative flex` element in the strip; the tabs are
    // wrapped in `flex-none` and the menus in `relative inline-flex`.
    const isRow = this.classList.contains('relative') && this.classList.contains('flex');
    const width = isRow ? rowWidth : 34 + 7 * (this.textContent?.trim().length ?? 0);
    return { width, height: 28, top: 0, left: 0, right: width, bottom: 28, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
  });
};

const renderTabs = (rowWidth: number, searchMode: SidebarSearchMode) => {
  stubLayout(rowWidth);
  const changes: SidebarSearchMode[] = [];
  render(
    <SidebarModeTabs
      searchMode={searchMode}
      onSearchModeChange={(mode) => changes.push(mode)}
      runningSessionsCount={0}
      t={t}
    />,
  );
  return changes;
};

test('a wide row shows every tab and no overflow menu', () => {
  renderTabs(400, 'projects');

  assert.ok(screen.getByRole('button', { name: 'Projects' }));
  assert.ok(screen.getByRole('button', { name: 'Conversations' }));
  assert.ok(screen.getByRole('button', { name: 'Running sessions' }));
  assert.ok(screen.getByRole('button', { name: 'Archive only' }));
  assert.equal(screen.queryByRole('button', { name: 'More' }), null);
});

test('a narrow row moves the tabs that no longer fit into the dropdown', () => {
  const changes = renderTabs(220, 'projects');

  assert.ok(screen.getByRole('button', { name: 'Projects' }));
  assert.equal(screen.queryByRole('button', { name: 'Conversations' }), null);

  fireEvent.click(screen.getByRole('button', { name: 'More' }));
  assert.ok(screen.getByRole('menuitem', { name: 'Running sessions' }));
  assert.ok(screen.getByRole('menuitem', { name: 'Archive only' }));

  fireEvent.click(screen.getByRole('menuitem', { name: 'Conversations' }));
  assert.deepEqual(changes, ['conversations']);
});

test('the section on screen keeps its place in the row', () => {
  renderTabs(220, 'archived');

  // Archive is the last tab and the first to be dropped on width alone, but it
  // is the open section, so the strip has to keep showing it as pressed.
  const archive = screen.getByRole('button', { name: 'Archive only' });
  assert.equal(archive.getAttribute('aria-pressed'), 'true');
  assert.equal(screen.queryByRole('button', { name: 'Conversations' }), null);
  assert.ok(screen.getByRole('button', { name: 'More' }));
});

test('a session waiting on an answer is counted on both lists with global accessible labels', () => {
  awaitingInput.sessionIds.add('s1');
  awaitingInput.sessionIds.add('s2');
  renderTabs(400, 'projects');

  // Both lists can contain the blocked session, so both carry the count and announce its workspace scope.
  const projectsTab = screen.getByRole('button', { name: /Projects, 2 waiting/i });
  const conversationsTab = screen.getByRole('button', { name: /Conversations, 2 waiting/i });
  assert.equal(projectsTab.textContent, 'Projects2');
  assert.equal(conversationsTab.textContent, 'Conversations2');
  assert.equal(projectsTab.getAttribute('title'), '2 waiting for your answer across all sessions');
});
