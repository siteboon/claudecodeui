import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

const TITLE = 'Keep the CloudCLI computer awake while agents work';

const notificationsTabProps = {
  notificationPreferences: {
    channels: { inApp: true, webPush: false, desktop: false, sound: false },
    events: { actionRequired: true, stop: true, error: true },
  },
  onNotificationPreferencesChange: () => {},
  pushPermission: 'unsupported' as const,
  isPushSubscribed: false,
  isPushLoading: false,
  onEnablePush: () => {},
  onDisablePush: () => {},
};

beforeEach(() => {
  keepAwake.mockReset();
  saveKeepAwake.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('KeepAwakeSettingsCard', () => {
  it('shows the saved setting and saves a change to the server', async () => {
    keepAwake.mockResolvedValue(statusResponse({ enabled: false, supported: true }));
    saveKeepAwake.mockResolvedValue(statusResponse({ enabled: true, supported: true }));
    render(<KeepAwakeSettingsCard />);

    const toggle = await screen.findByRole('switch', { name: TITLE });
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    expect(screen.getByText(/including while it waits for your answer or a tool approval/)).toBeTruthy();
    expect(screen.getByText(/Closing a laptop's lid can still put it to sleep/)).toBeTruthy();

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
    expect(
      screen.getByText('Not available on the computer running CloudCLI. Linux needs systemd (systemd-inhibit); WSL is not supported.'),
    ).toBeTruthy();
  });

  it('cannot be toggled again while a save is still in flight', async () => {
    keepAwake.mockResolvedValue(statusResponse({ enabled: false, supported: true }));
    let answerSave: (response: unknown) => void = () => {};
    saveKeepAwake.mockReturnValue(new Promise((resolve) => {
      answerSave = resolve;
    }));
    render(<KeepAwakeSettingsCard />);

    const toggle = await screen.findByRole('switch', { name: TITLE });
    fireEvent.click(toggle);
    await waitFor(() => expect(toggle.hasAttribute('disabled')).toBe(true));
    fireEvent.click(toggle);
    expect(saveKeepAwake).toHaveBeenCalledTimes(1);

    answerSave(statusResponse({ enabled: true, supported: true }));
    await waitFor(() => expect(toggle.hasAttribute('disabled')).toBe(false));
    expect(toggle.getAttribute('aria-checked')).toBe('true');
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
    render(<NotificationsSettingsTab {...notificationsTabProps} />);

    const toggle = await screen.findByRole('switch', { name: TITLE });
    expect(toggle.getAttribute('aria-checked')).toBe('true');
  });

  it('leaves the card out on hosted instances, where there is no computer of the user\'s to keep awake', async () => {
    // IS_PLATFORM is read from the build-time flag when shared/utils loads, so
    // the tab is loaded fresh with the flag stubbed.
    vi.stubEnv('VITE_IS_PLATFORM', 'true');
    vi.resetModules();
    const { default: PlatformNotificationsSettingsTab } = await import('@/modules/settings/tabs/NotificationsSettingsTab');
    keepAwake.mockResolvedValue(statusResponse({ enabled: true, supported: true }));
    render(<PlatformNotificationsSettingsTab {...notificationsTabProps} />);

    expect(await screen.findByText('Control which notification events you receive.')).toBeTruthy();
    expect(screen.queryByText(TITLE)).toBeNull();
    expect(keepAwake).not.toHaveBeenCalled();
  });
});

describe('api.system keep-awake helpers', () => {
  it('read the setting with GET and save it with PUT { enabled } at /api/system/keep-awake', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const { api } = await vi.importActual<typeof ApiModule>('@/shared/api');

    await api.system.keepAwake();
    expect(fetchMock.mock.calls[0][0]).toBe('/api/system/keep-awake');
    expect(fetchMock.mock.calls[0][1]?.method ?? 'GET').toBe('GET');

    await api.system.saveKeepAwake(true);
    expect(fetchMock.mock.calls[1][0]).toBe('/api/system/keep-awake');
    expect(fetchMock.mock.calls[1][1]?.method).toBe('PUT');
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toEqual({ enabled: true });
  });
});
