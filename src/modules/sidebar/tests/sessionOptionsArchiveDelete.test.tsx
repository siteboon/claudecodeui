import assert from 'node:assert/strict';

import { act, fireEvent, render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import type { TFunction } from 'i18next';
import { test, vi } from 'vitest';

import SessionOptions from '@/modules/sidebar/SessionOptions';

vi.mock('@/shared/api', () => ({
  api: {
    providerSessionId: async () => ({
      ok: true,
      json: async () => ({ data: { sessionId: 'native-session-1' } }),
    }),
    providers: {
      capabilities: async () => ({
        json: async () => ({ success: true, data: { providers: [] } }),
      }),
    },
  },
}));

const t = ((key: string) => key) as TFunction;
const noop = () => {};

const optionsProps = (
  overrides: Partial<ComponentProps<typeof SessionOptions>> = {},
): ComponentProps<typeof SessionOptions> => ({
  sessionId: 'session-1',
  sessionName: 'Session one',
  provider: 'claude',
  projectId: 'project-1',
  isProcessing: false,
  isEditing: false,
  renameDraft: '',
  onRenameDraftChange: noop,
  onStartEditingSession: noop,
  onCancelEditingSession: noop,
  onSaveEditingSession: noop,
  onArchiveSession: noop,
  onDeleteSession: noop,
  t,
  ...overrides,
});

const openMenu = async () => {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Session options for Session one' }));
  });
};

test('the desktop menu offers archive and delete as separate items', async () => {
  render(<SessionOptions {...optionsProps()} />);
  await openMenu();

  const archive = screen.getByRole('menuitem', { name: /Archive session/ });
  const remove = screen.getByRole('menuitem', { name: /Delete session/ });
  assert.equal(screen.queryByRole('menuitem', { name: /Archive or delete/ }), null);
  // Only delete is styled as destructive.
  assert.ok(!/red/.test(archive.className));
  assert.ok(/red/.test(remove.className));
});

test('archive archives directly and delete asks for the permanent delete', async () => {
  const onArchiveSession = vi.fn();
  const onDeleteSession = vi.fn();
  render(<SessionOptions {...optionsProps({ onArchiveSession, onDeleteSession })} />);

  await openMenu();
  fireEvent.click(screen.getByRole('menuitem', { name: /Archive session/ }));
  assert.deepEqual(onArchiveSession.mock.calls, [['session-1']]);
  assert.equal(onDeleteSession.mock.calls.length, 0);

  await openMenu();
  fireEvent.click(screen.getByRole('menuitem', { name: /Delete session/ }));
  assert.deepEqual(onDeleteSession.mock.calls, [['session-1', 'Session one']]);
  assert.equal(onArchiveSession.mock.calls.length, 1);
});

test('a running session offers neither archive nor delete', async () => {
  render(<SessionOptions {...optionsProps({ isProcessing: true })} />);
  await openMenu();

  assert.equal(screen.queryByRole('menuitem', { name: /Archive session/ }), null);
  assert.equal(screen.queryByRole('menuitem', { name: /Delete session/ }), null);
});
