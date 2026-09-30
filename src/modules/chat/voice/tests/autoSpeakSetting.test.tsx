import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import AutoSpeakSetting from '@/modules/chat/voice/AutoSpeakSetting';
import csVoice from '@/modules/chat/voice/locales/cs/voice.json';
import { voiceI18n } from '@/modules/chat/voice/voiceI18n';
import { resetVoiceHealth } from '@/modules/chat/voice/voiceState';
import { fakeResponse, setUiPreferences } from '@/modules/chat/voice/tests/kit';
import { UiPreferencesProvider } from '@/shared/context/UiPreferencesContext';
import { readStoredUiPreferences } from '@/shared/uiPreferences';
import { resetUserPreferences } from '@/shared/userSettings';
import type * as SharedApi from '@/shared/api';

const h = vi.hoisted(() => ({ health: vi.fn() }));

vi.mock('@/shared/api', async (importOriginal) => {
  const actual = await importOriginal<typeof SharedApi>();
  return {
    ...actual,
    api: {
      ...actual.api,
      voice: { ...actual.api.voice, health: () => h.health() },
      user: { ...actual.api.user, savePreferences: async () => ({ ok: true, json: async () => ({}) }) },
    },
  };
});

const renderSetting = (variant: 'quick' | 'settings') =>
  render(<UiPreferencesProvider><AutoSpeakSetting variant={variant} /></UiPreferencesProvider>);

beforeEach(async () => {
  localStorage.clear();
  resetUserPreferences();
  resetVoiceHealth();
  h.health.mockReset();
  h.health.mockImplementation(async () => fakeResponse(200, { configured: true }));
  await voiceI18n.changeLanguage('cs');
});

describe('the autoSpeak preference (KTD8)', () => {
  test('on a fresh container autoSpeak reads off', () => {
    expect(readStoredUiPreferences().autoSpeak).toBe(false);
  });

  test('disabled with its explanation while voiceEnabled is off, and no health request', async () => {
    renderSetting('settings');
    const toggle = screen.getByRole('switch', { name: csVoice.autoSpeak.label });
    expect((toggle as HTMLButtonElement).disabled).toBe(true);
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    expect(screen.getByText(csVoice.autoSpeak.unavailable)).toBeTruthy();
    expect(h.health).not.toHaveBeenCalled();
  });

  test('disabled with its explanation while /api/voice/health reports unconfigured', async () => {
    h.health.mockImplementation(async () => fakeResponse(200, { configured: false }));
    await setUiPreferences({ voiceEnabled: true });
    renderSetting('settings');
    await waitFor(() => expect(h.health).toHaveBeenCalled());
    const toggle = screen.getByRole('switch', { name: csVoice.autoSpeak.label });
    expect((toggle as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(csVoice.autoSpeak.unavailable)).toBeTruthy();
  });

  test('enabled once voice is on and configured; switching it on stores the preference', async () => {
    await setUiPreferences({ voiceEnabled: true });
    renderSetting('settings');
    const toggle = screen.getByRole('switch', { name: csVoice.autoSpeak.label });
    await waitFor(() => expect((toggle as HTMLButtonElement).disabled).toBe(false));
    expect(screen.getByText(csVoice.autoSpeak.description)).toBeTruthy();
    fireEvent.click(toggle);
    await waitFor(() => expect(readStoredUiPreferences().autoSpeak).toBe(true));
  });

  test('the Quick Settings row is absent while voice is off and a labelled checkbox once it is on', async () => {
    const off = renderSetting('quick');
    expect(off.container.innerHTML).toBe('');
    off.unmount();

    await setUiPreferences({ voiceEnabled: true });
    renderSetting('quick');
    const box = screen.getByRole('checkbox', { name: csVoice.autoSpeak.label });
    await waitFor(() => expect((box as HTMLInputElement).disabled).toBe(false));
  });
});
