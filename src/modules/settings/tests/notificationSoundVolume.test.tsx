import assert from 'node:assert/strict';

import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, test, vi } from 'vitest';

import '@/modules/i18n';
import NotificationsSettingsTab from '@/modules/settings/tabs/NotificationsSettingsTab';
import type { NotificationPreferencesState } from '@/shared/types';

/**
 * The chime volume (#1548) sits next to the sound on/off switch in Settings >
 * Notifications and is saved the same way: with the notification preferences
 * on the server, and mirrored into localStorage, where the chime reads it.
 */

const savedNotificationPreferences = vi.hoisted(() => ({
  current: null as Record<string, unknown> | null,
  saves: [] as unknown[],
}));

vi.mock('@/shared/api', () => {
  const ok = async () => new Response('{}', {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

  return {
    api: {
      settings: {
        notificationPreferences: async () => new Response(JSON.stringify({
          success: true,
          preferences: savedNotificationPreferences.current,
        }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
        saveNotificationPreferences: async (preferences: unknown) => {
          savedNotificationPreferences.saves.push(preferences);
          return ok();
        },
      },
      user: {
        preferences: async () => new Response(JSON.stringify({ preferences: {} }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
        savePreferences: ok,
        drafts: ok,
        saveDraft: ok,
        deleteDraft: ok,
      },
    },
  };
});

// Stable identities: the controller's open-effect depends on these functions.
vi.mock('@/shared/context/ThemeContext', () => {
  const theme = { isDarkMode: false, toggleDarkMode: () => undefined };
  return { useTheme: () => theme };
});

vi.mock('@/modules/provider-auth', () => {
  const authStatus = {
    providerAuthStatus: {},
    checkProviderAuthStatus: () => Promise.resolve({ authenticated: false }),
    refreshProviderAuthStatuses: () => Promise.resolve(),
  };
  return { useProviderAuthStatus: () => authStatus };
});

const PREFERENCES: NotificationPreferencesState = {
  channels: { inApp: true, webPush: false, desktop: false, sound: true },
  events: { actionRequired: true, stop: true, error: true },
  soundVolume: 70,
};

const renderTab = (onChange: (value: NotificationPreferencesState) => void) => render(
  <NotificationsSettingsTab
    notificationPreferences={PREFERENCES}
    onNotificationPreferencesChange={onChange}
    pushPermission="default"
    isPushSubscribed={false}
    isPushLoading={false}
    onEnablePush={() => undefined}
    onDisablePush={() => undefined}
  />,
);

beforeEach(() => {
  savedNotificationPreferences.current = null;
  savedNotificationPreferences.saves = [];
  localStorage.clear();
});

afterEach(() => {
  localStorage.clear();
});

test('the Sound card has a volume slider that reports the new volume', () => {
  const changes: NotificationPreferencesState[] = [];
  renderTab((value) => { changes.push(value); });

  const slider = screen.getByLabelText('Volume') as HTMLInputElement;
  assert.equal(slider.type, 'range');
  assert.equal(slider.value, '70');
  assert.ok(screen.getByText('70%'));

  fireEvent.change(slider, { target: { value: '40' } });
  assert.deepEqual(changes, [{ ...PREFERENCES, soundVolume: 40 }]);
});

test('the saved volume reaches the chime mirror and a new one is saved with the other preferences', async () => {
  savedNotificationPreferences.current = {
    channels: { inApp: true, webPush: false, desktop: false, sound: true },
    events: { actionRequired: true, stop: true, error: true },
    soundVolume: 30,
  };
  const { useSettingsController } = await import('@/modules/settings/hooks/useSettingsController');
  const { result } = renderHook(() => useSettingsController({ isOpen: true, initialTab: 'notifications' }));

  await waitFor(() => {
    assert.equal(result.current.notificationPreferences.soundVolume, 30);
  });
  assert.equal(localStorage.getItem('notificationSoundVolume'), '30');

  act(() => {
    result.current.setNotificationPreferences({ ...result.current.notificationPreferences, soundVolume: 55 });
  });
  assert.equal(localStorage.getItem('notificationSoundVolume'), '55');
  await waitFor(() => {
    const lastSave = savedNotificationPreferences.saves.at(-1) as NotificationPreferencesState | undefined;
    assert.equal(lastSave?.soundVolume, 55);
  }, { timeout: 3000 });
});

test('preferences from a server that predates the setting load at the default volume', async () => {
  savedNotificationPreferences.current = {
    channels: { inApp: true, webPush: false, desktop: false, sound: true },
    events: { actionRequired: true, stop: true, error: true },
  };
  const { useSettingsController } = await import('@/modules/settings/hooks/useSettingsController');
  const { result } = renderHook(() => useSettingsController({ isOpen: true, initialTab: 'notifications' }));

  await waitFor(() => {
    assert.equal(result.current.notificationPreferences.channels.inApp, true);
  });
  assert.equal(result.current.notificationPreferences.soundVolume, 70);
  assert.equal(localStorage.getItem('notificationSoundVolume'), '70');
});
