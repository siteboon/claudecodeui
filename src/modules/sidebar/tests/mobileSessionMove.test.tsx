import assert from 'node:assert/strict';

import { act, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { test, vi } from 'vitest';

import type { Project, SessionWithProvider, SidebarProjectListProps } from '@/shared/types';

/**
 * The touch layout renders its own bottom sheet instead of SessionOptions, so
 * "Move to project" has to be offered there too, under the same gate.
 */

vi.mock('@/modules/sidebar/hooks/useCompactSidebar', () => ({ useCompactSidebar: () => true }));
vi.mock('@/shared/hooks/useProviderCapabilities', () => ({
  useSessionMovingProviders: () => new Set(['claude']),
  useSessionForkingProviders: () => new Set(),
}));

const { default: SidebarSessionItem } = await import('@/modules/sidebar/SidebarSessionItem');

const t = ((key: string) => key) as unknown as SidebarProjectListProps['t'];
const noop = () => {};
const PROJECT = { projectId: 'project-1', displayName: 'project one', fullPath: '/tmp/project-1', sessions: [] } as unknown as Project;
const SESSION = { id: 's1', summary: 'session one', lastActivity: '2026-08-21T09:59:00.000Z', __provider: 'claude' } as unknown as SessionWithProvider;

const renderRow = (overrides: Record<string, unknown>) => render(
  React.createElement(SidebarSessionItem, {
    project: PROJECT,
    session: SESSION,
    selectedSession: null,
    isProcessing: false,
    hasBackgroundWork: false,
    needsAttention: false,
    currentTime: new Date('2026-08-21T10:00:00.000Z'),
    isEditing: false,
    renameDraft: '',
    onRenameDraftChange: noop,
    onStartEditingSession: noop,
    onCancelEditingSession: noop,
    onSaveEditingSession: noop,
    onProjectSelect: noop,
    onSessionSelect: noop,
    onDeleteSession: noop,
    isSelecting: false,
    isChecked: false,
    onToggleSessionSelected: noop,
    t,
    ...overrides,
  }),
);

test('the mobile options sheet offers moving the session to another project', () => {
  const onMoveSession = vi.fn();
  renderRow({ onMoveSession });

  act(() => {
    fireEvent.click(screen.getByRole('button', { name: 'Session options for session one' }));
  });
  act(() => {
    fireEvent.click(screen.getByRole('button', { name: 'actions.moveSession' }));
  });

  assert.equal(onMoveSession.mock.calls.length, 1);
  assert.equal(onMoveSession.mock.calls[0][0].id, 's1');
});

test('a running session is not offered a move on mobile', () => {
  renderRow({ onMoveSession: vi.fn(), isProcessing: true });

  act(() => {
    fireEvent.click(screen.getByRole('button', { name: 'Session options for session one' }));
  });

  assert.equal(screen.queryByRole('button', { name: 'actions.moveSession' }), null);
});
