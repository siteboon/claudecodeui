import assert from 'node:assert/strict';

import { act, fireEvent, render, screen, within } from '@testing-library/react';
import type { ComponentProps } from 'react';
import type { TFunction } from 'i18next';
import { test, vi } from 'vitest';

import SidebarSessionItem from '@/modules/sidebar/SidebarSessionItem';
import type { LLMProvider, Project, SessionWithProvider } from '@/shared/types';

// Exercise the real shared capability hook: the row's menu must follow the
// server matrix and withhold actions for missing or unsupported providers.
vi.mock('@/shared/api', () => ({
  api: {
    providerSessionId: async () => ({
      ok: true,
      json: async () => ({ data: { sessionId: 'native-session-1' } }),
    }),
    providers: {
      capabilities: async () => ({
        json: async () => ({
          success: true,
          data: {
            providers: [
              { provider: 'claude', supportsSessionForking: true },
              { provider: 'codex', supportsSessionForking: true },
              { provider: 'cursor', supportsSessionForking: false },
            ],
          },
        }),
      }),
    },
  },
}));

const PROJECT: Project = {
  projectId: 'project-1',
  displayName: 'Project one',
  fullPath: '/tmp/project-1',
};
const SESSION: SessionWithProvider = {
  id: 'session-1',
  summary: 'Session one',
  __provider: 'claude',
  __projectId: PROJECT.projectId,
};
const t = ((key: string) => key) as TFunction;
const noop = () => {};

const rowProps = (
  overrides: Partial<ComponentProps<typeof SidebarSessionItem>> = {},
): ComponentProps<typeof SidebarSessionItem> => ({
  project: PROJECT,
  session: SESSION,
  selectedSession: null,
  isProcessing: false,
  hasBackgroundWork: false,
  needsAttention: false,
  currentTime: new Date('2026-10-17T00:00:00.000Z'),
  isEditing: false,
  renameDraft: '',
  onRenameDraftChange: noop,
  onStartEditingSession: noop,
  onCancelEditingSession: noop,
  onSaveEditingSession: noop,
  onSessionSelect: noop,
  onArchiveSession: noop,
  onDeleteSession: noop,
  onForkSession: noop,
  isSelecting: false,
  isChecked: false,
  onToggleSessionSelected: noop,
  t,
  ...overrides,
});

const openOptions = async () => {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Session options for Session one' }));
  });
  return within(screen.getByRole('menu'));
};

test.each<LLMProvider>(['claude', 'codex'])('the menu offers a fork for a supported %s session', async (provider) => {
  render(<SidebarSessionItem {...rowProps({ session: { ...SESSION, __provider: provider } })} />);
  const menu = await openOptions();

  assert.ok(menu.getByRole('menuitem', { name: /Fork session/ }));
  assert.ok(menu.getByRole('menuitem', { name: 'Rename session' }));
  assert.ok(menu.getByRole('menuitem', { name: 'Archive session' }));
  assert.ok(menu.getByRole('menuitem', { name: 'Delete session' }));
});

test('archive and delete are separate actions with their own handlers', async () => {
  const onArchiveSession = vi.fn();
  const onDeleteSession = vi.fn();
  const { unmount } = render(<SidebarSessionItem {...rowProps({ onArchiveSession, onDeleteSession })} />);
  let menu = await openOptions();

  fireEvent.click(menu.getByRole('menuitem', { name: 'Archive session' }));
  assert.deepEqual(onArchiveSession.mock.calls, [[SESSION.id]]);
  assert.equal(onDeleteSession.mock.calls.length, 0);
  assert.equal(screen.queryByRole('menu'), null);
  unmount();

  render(<SidebarSessionItem {...rowProps({ onArchiveSession, onDeleteSession })} />);
  menu = await openOptions();
  fireEvent.click(menu.getByRole('menuitem', { name: 'Delete session' }));
  assert.deepEqual(onDeleteSession.mock.calls, [[SESSION.id, 'Session one']]);
  assert.equal(onArchiveSession.mock.calls.length, 1);
});

test('the menu withholds archive and delete while the session is running', async () => {
  render(<SidebarSessionItem {...rowProps({ isProcessing: true })} />);
  const menu = await openOptions();

  assert.equal(menu.queryByRole('menuitem', { name: 'Archive session' }), null);
  assert.equal(menu.queryByRole('menuitem', { name: 'Delete session' }), null);
});

test('forking passes the owning session once and closes the menu', async () => {
  const onForkSession = vi.fn();
  const onSessionSelect = vi.fn();
  render(<SidebarSessionItem {...rowProps({ onForkSession, onSessionSelect })} />);
  const menu = await openOptions();

  fireEvent.click(menu.getByRole('menuitem', { name: /Fork session/ }));

  assert.deepEqual(onForkSession.mock.calls, [[SESSION]]);
  assert.equal(onSessionSelect.mock.calls.length, 0);
  assert.equal(screen.queryByRole('menu'), null);
  assert.equal(screen.getByRole('button', { name: 'Session options for Session one' }).getAttribute('aria-expanded'), 'false');
});

test.each<LLMProvider>(['cursor', 'opencode'])('the menu withholds a fork when %s is unsupported or absent from the matrix', async (provider) => {
  render(<SidebarSessionItem {...rowProps({ session: { ...SESSION, __provider: provider } })} />);
  const menu = await openOptions();

  assert.equal(menu.queryByRole('menuitem', { name: /Fork session/ }), null);
});

test('the menu withholds a fork when its caller provides no fork handler', async () => {
  render(<SidebarSessionItem {...rowProps({ onForkSession: undefined })} />);
  const menu = await openOptions();

  assert.equal(menu.queryByRole('menuitem', { name: /Fork session/ }), null);
});

test('the menu withholds a fork while the session is running, including when it starts with the menu open', async () => {
  const props = rowProps({ isProcessing: true });
  const { rerender } = render(<SidebarSessionItem {...props} />);
  const menu = await openOptions();
  assert.equal(menu.queryByRole('menuitem', { name: /Fork session/ }), null);

  rerender(<SidebarSessionItem {...props} isProcessing={false} />);
  assert.ok(menu.getByRole('menuitem', { name: /Fork session/ }));

  rerender(<SidebarSessionItem {...props} />);
  assert.equal(menu.queryByRole('menuitem', { name: /Fork session/ }), null);
});

test('background work alone keeps the fork available', async () => {
  render(<SidebarSessionItem {...rowProps({ hasBackgroundWork: true })} />);
  const menu = await openOptions();

  assert.ok(menu.getByRole('menuitem', { name: /Fork session/ }));
});

test('bulk selection withholds the options trigger', () => {
  render(<SidebarSessionItem {...rowProps({ isSelecting: true })} />);

  assert.equal(screen.queryByRole('button', { name: 'Session options for Session one' }), null);
});
