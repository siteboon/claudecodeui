import assert from 'node:assert/strict';

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, test, vi } from 'vitest';

import '@/modules/i18n';

/**
 * Issue #797: there was no way to sign out of the web UI short of clearing
 * browser data. The sidebar now offers Sign Out under Settings in all three
 * places Settings appears, behind a confirmation, and nowhere in platform mode
 * where there is no local sign-in.
 */

const logout = vi.fn();

vi.mock('@/modules/auth', () => ({
  useAuth: () => ({ logout }),
}));

const loadButton = async (isPlatform: boolean) => {
  vi.stubEnv('VITE_IS_PLATFORM', isPlatform ? 'true' : 'false');
  vi.resetModules();
  return (await import('@/modules/sidebar/SidebarSignOutButton')).default;
};

afterEach(() => {
  cleanup();
  logout.mockReset();
  vi.unstubAllEnvs();
});

// Value: protects=every placement offers Sign Out with a named, described dialog; fails_when=a variant renders no trigger or an unlabeled icon, or the dialog loses its title or description link; why_new=new component; seam=none; no_claim=visual styling
test('each placement renders a Sign Out trigger that opens the confirmation', async () => {
  const SidebarSignOutButton = await loadButton(false);

  for (const variant of ['row', 'tile', 'icon'] as const) {
    render(<SidebarSignOutButton variant={variant} />);
    fireEvent.click(screen.getByRole('button', { name: 'Sign Out' }));

    const dialog = screen.getByRole('dialog', { name: 'Sign Out', description: 'Are you sure you want to sign out?' });
    assert.ok(dialog);
    cleanup();
  }
  assert.equal(logout.mock.calls.length, 0);
});

// Value: protects=sign-out needs an explicit confirmation; fails_when=Cancel or Esc signs out or Confirm is skipped; why_new=new component; seam=vi.mock('@/modules/auth'); no_claim=real AuthProvider session clearing
test('Cancel and Esc close the confirmation without signing out', async () => {
  const SidebarSignOutButton = await loadButton(false);
  render(<SidebarSignOutButton variant="row" />);

  fireEvent.click(screen.getByRole('button', { name: 'Sign Out' }));
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  assert.equal(screen.queryByRole('dialog'), null);

  fireEvent.click(screen.getByRole('button', { name: 'Sign Out' }));
  fireEvent.keyDown(document, { key: 'Escape' });
  assert.equal(screen.queryByRole('dialog'), null);

  assert.equal(logout.mock.calls.length, 0);
});

// Value: protects=confirming signs out exactly once; fails_when=Confirm does not call logout or calls it twice; why_new=new component; seam=vi.mock('@/modules/auth'); no_claim=real AuthProvider session clearing
test('confirming signs out once and closes the dialog', async () => {
  const SidebarSignOutButton = await loadButton(false);
  render(<SidebarSignOutButton variant="tile" />);

  fireEvent.click(screen.getByRole('button', { name: 'Sign Out' }));
  const dialog = screen.getByRole('dialog');
  const confirm = Array.from(dialog.querySelectorAll('button')).find((button) => button.textContent === 'Sign Out');
  assert.ok(confirm);
  fireEvent.click(confirm);

  assert.equal(logout.mock.calls.length, 1);
  assert.equal(screen.queryByRole('dialog'), null);
});

// Value: protects=no sign-out in platform mode; fails_when=the IS_PLATFORM check is removed; why_new=platform hiding lives in this component; seam=none; no_claim=real platform build
test('platform mode renders no Sign Out trigger', async () => {
  const SidebarSignOutButton = await loadButton(true);
  const { container } = render(<SidebarSignOutButton variant="row" />);

  assert.equal(container.innerHTML, '');
});
