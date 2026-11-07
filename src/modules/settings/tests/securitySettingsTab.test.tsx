import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import '@/modules/i18n';
import SecuritySettingsTab from '@/modules/settings/tabs/SecuritySettingsTab';

const logout = vi.fn();
vi.mock('@/modules/auth', () => ({
  useAuth: () => ({ user: { id: 1, username: 'alice' }, logout }),
}));

/**
 * Drives the account tab against a stand-in for POST /api/auth/change-password,
 * so the real api helper and the error-code mapping are exercised.
 */

type Recorded = { url: string; body: unknown };
let calls: Recorded[];

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json' },
});

function fakeServer(url: string, init: RequestInit = {}): Response {
  const body = init.body ? JSON.parse(String(init.body)) : undefined;
  calls.push({ url, body });
  if (url === '/api/auth/change-password' && init.method === 'POST') {
    return body.currentPassword === 'old-secret'
      ? json(200, { success: true })
      : json(400, { success: false, error: { code: 'AUTH_INVALID_CURRENT_PASSWORD', message: 'server text' } });
  }
  return json(404, {});
}

function fillForm(current: string, next: string, confirm: string) {
  fireEvent.change(screen.getByLabelText('Current password'), { target: { value: current } });
  fireEvent.change(screen.getByLabelText('New password'), { target: { value: next } });
  fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: confirm } });
  fireEvent.click(screen.getByRole('button', { name: 'Change Password' }));
}

describe('SecuritySettingsTab', () => {
  beforeEach(() => {
    calls = [];
    logout.mockReset();
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => fakeServer(url, init)));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('submits the current and new password and clears the form on success', async () => {
    render(<SecuritySettingsTab />);
    fillForm('old-secret', 'new-secret', 'new-secret');

    expect(await screen.findByText('Password changed')).toBeTruthy();
    expect(calls).toEqual([
      { url: '/api/auth/change-password', body: { currentPassword: 'old-secret', newPassword: 'new-secret' } },
    ]);
    expect((screen.getByLabelText('Current password') as HTMLInputElement).value).toBe('');
  });

  it('shows a localized message when the current password is wrong', async () => {
    render(<SecuritySettingsTab />);
    fillForm('wrong', 'new-secret', 'new-secret');

    expect(await screen.findByText('Current password is incorrect')).toBeTruthy();
    expect((screen.getByLabelText('New password') as HTMLInputElement).value).toBe('new-secret');
  });

  it('rejects mismatched confirmation without calling the server', async () => {
    render(<SecuritySettingsTab />);
    fillForm('old-secret', 'new-secret', 'different');

    expect(await screen.findByText("New passwords don't match")).toBeTruthy();
    expect(calls).toEqual([]);
  });

  it('rejects a short new password without calling the server', async () => {
    render(<SecuritySettingsTab />);
    fillForm('old-secret', '12345', '12345');

    expect(await screen.findByText('New password must be at least 6 characters')).toBeTruthy();
    expect(calls).toEqual([]);
  });

  it('signs out through the auth context', async () => {
    render(<SecuritySettingsTab />);
    fireEvent.click(screen.getByRole('button', { name: 'Sign Out' }));

    await waitFor(() => expect(logout).toHaveBeenCalledTimes(1));
  });
});
