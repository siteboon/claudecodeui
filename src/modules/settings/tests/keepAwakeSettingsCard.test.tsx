import { beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import '@/modules/i18n';
import type * as ApiModule from '@/shared/api';
import KeepAwakeSettingsCard from '@/modules/settings/tabs/KeepAwakeSettingsCard';
import NotificationsSettingsTab from '@/modules/settings/tabs/NotificationsSettingsTab';

// Issue #902: the computer running CloudCLI can be kept out of idle sleep
// while agents work. The card reads and saves the server-side setting.

const keepAwake = vi.fn();
const saveKeepAwake = vi.fn();

vi.mock('@/shared/api', async (importOriginal) => {
  const actual = await importOriginal<typeof ApiModule>();
  return {
    ...actual,
    api: {
      ...actual.api,
      system: {
        ...actual.api.system,
        keepAwake: (...args: unknown[]) => keepAwake(...args),
        saveKeepAwake: (...args: unknown[]) => saveKeepAwake(...args),
      },
    },
  };
});

const jsonResponse = (body: unknown, status = 200) => ({
  ok: status < 400,
  status,
  json: async () => body,
});

const statusResponse = (status: { enabled: boolean; supported: boolean; active?: boolean }) =>
  jsonResponse({ success: true, data: { active: false, ...status } });

const TITLE = 'Keep this computer awake while agents work';

beforeEach(() => {
  keepAwake.mockReset();
  saveKeepAwake.mockReset();
});

describe('KeepAwakeSettingsCard', () => {
  it('shows the saved setting and saves a change to the server', async () => {
    keepAwake.mockResolvedValue(statusResponse({ enabled: false, supported: true }));
    saveKeepAwake.mockResolvedValue(statusResponse({ enabled: true, supported: true }));
    render(<KeepAwakeSettingsCard />);

    const toggle = await screen.findByRole('switch', { name: TITLE });
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    expect(screen.getByText(/closing a laptop's lid can still put it to sleep/)).toBeTruthy();

    fireEvent.click(toggle);

    expect(saveKeepAwake).toHaveBeenCalledWith(true);
    await waitFor(() => expect(toggle.getAttribute('aria-checked')).toBe('true'));
  });

  it('is disabled and says so where this computer cannot be kept awake', async () => {
    keepAwake.mockResolvedValue(statusResponse({ enabled: true, supported: false }));
    render(<KeepAwakeSettingsCard />);

    const toggle = await screen.findByRole('switch', { name: TITLE });
    expect(toggle.hasAttribute('disabled')).toBe(true);
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    expect(screen.getByText('Not available on this computer. On Linux, this needs systemd (systemd-inhibit).')).toBeTruthy();
  });

  it('keeps the previous value and reports a save that failed', async () => {
    keepAwake.mockResolvedValue(statusResponse({ enabled: false, supported: true }));
    saveKeepAwake.mockResolvedValue(jsonResponse({ success: false, error: { code: 'INTERNAL_ERROR', message: 'boom' } }, 500));
    render(<KeepAwakeSettingsCard />);

    const toggle = await screen.findByRole('switch', { name: TITLE });
    fireEvent.click(toggle);

    expect(await screen.findByText('Could not save this setting. Please try again.')).toBeTruthy();
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    expect(toggle.hasAttribute('disabled')).toBe(false);
  });

  it('reports a status that could not be loaded', async () => {
    keepAwake.mockRejectedValue(new Error('offline'));
    render(<KeepAwakeSettingsCard />);

    expect(await screen.findByText('Could not load this setting.')).toBeTruthy();
    expect(screen.queryByRole('switch')).toBeNull();
  });
});

describe('NotificationsSettingsTab', () => {
  it('offers to keep the computer awake alongside the other settings for unattended runs', async () => {
    keepAwake.mockResolvedValue(statusResponse({ enabled: true, supported: true }));
    render(
      <NotificationsSettingsTab
        notificationPreferences={{
          channels: { inApp: true, webPush: false, desktop: false, sound: false },
          events: { actionRequired: true, stop: true, error: true },
        }}
        onNotificationPreferencesChange={() => {}}
        pushPermission="unsupported"
        isPushSubscribed={false}
        isPushLoading={false}
        onEnablePush={() => {}}
        onDisablePush={() => {}}
      />,
    );

    const toggle = await screen.findByRole('switch', { name: TITLE });
    expect(toggle.getAttribute('aria-checked')).toBe('true');
  });
});
