import assert from 'node:assert/strict';
import { fireEvent, render } from '@testing-library/react';
import React from 'react';
import { test, vi } from 'vitest';
import type { Project, SessionWithProvider, SidebarProjectListProps } from '@/shared/types';

vi.mock('@/modules/sidebar/hooks/useCompactSidebar', () => ({ useCompactSidebar: () => false }));
vi.mock('@/modules/sidebar/SessionOptions', () => ({ default: () => null }));
const { default: SidebarSessionItem } = await import('@/modules/sidebar/SidebarSessionItem');
const project = { projectId: 'project-1', name: 'project', fullPath: '/tmp/project', sessions: [] } as unknown as Project;
const session = { id: 'session-1', summary: 'Fix login', __provider: 'claude', lastActivity: '2026-10-29T10:00:00Z' } as unknown as SessionWithProvider;
const noop = () => {};

function renderRow(overrides: { isSelecting?: boolean; isEditing?: boolean } = {}) {
  const rename = vi.fn();
  const select = vi.fn();
  const rendered = render(React.createElement(SidebarSessionItem, {
    project, session, selectedSession: null, isProcessing: false, hasBackgroundWork: false,
    needsAttention: false, currentTime: new Date('2026-10-29T11:00:00Z'), isEditing: false,
    renameDraft: '', onRenameDraftChange: noop, onStartEditingSession: rename,
    onCancelEditingSession: noop, onSaveEditingSession: noop, onProjectSelect: noop,
    onSessionSelect: select, onDeleteSession: noop, isSelecting: false, isChecked: false,
    onToggleSessionSelected: noop, t: ((key: string) => key) as SidebarProjectListProps['t'], ...overrides,
  }));
  const title = rendered.getByText('Fix login');
  return { ...rendered, title, rename, select };
}

test('double-clicking a session title invokes the existing rename action', () => {
  const { title, rename, select } = renderRow();
  fireEvent.click(title, { detail: 1 });
  fireEvent.click(title, { detail: 2 });
  fireEvent.doubleClick(title, { detail: 2 });
  assert.deepEqual(select.mock.calls, [[session, 'project-1']]);
  assert.deepEqual(rename.mock.calls, [['project-1', 'session-1', 'Fix login']]);
});

test('a single click still selects the session without renaming', () => {
  const { title, rename, select } = renderRow();
  fireEvent.click(title);
  assert.equal(rename.mock.calls.length, 0);
  assert.deepEqual(select.mock.calls, [[session, 'project-1']]);
});

for (const modifier of ['ctrlKey', 'metaKey', 'shiftKey', 'altKey']) {
  test(`a ${modifier} double-click does not start renaming`, () => {
    const { title, rename } = renderRow();
    fireEvent.doubleClick(title, { [modifier]: true });
    assert.equal(rename.mock.calls.length, 0);
  });
}

for (const state of ['isSelecting', 'isEditing']) {
  test(`double-click does not start another rename while ${state}`, () => {
    const { title, rename } = renderRow({ [state]: true });
    fireEvent.doubleClick(title);
    assert.equal(rename.mock.calls.length, 0);
  });
}
