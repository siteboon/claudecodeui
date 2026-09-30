import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import VoiceSettingsTab from '@/modules/settings/tabs/VoiceSettingsTab';
import { UiPreferencesProvider } from '@/shared/context/UiPreferencesContext';
import { resetUserPreferences, writeUserPreference } from '@/shared/userSettings';

/**
 * Voice overlay, KTD7: in platform mode the workspace's voice service is the only
 * backend, so the Voice tab offers no Base URL or API key field - not even when
 * this browser still holds values typed before the overlay existed.
 */

beforeEach(() => {
  localStorage.clear();
  resetUserPreferences();
  localStorage.setItem('voiceConfig', JSON.stringify({ baseUrl: 'https://vendor.example/v1', apiKey: 'sk-builder-typed' }));
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ configured: true }), { status: 200 })));
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

test('the settings tab renders no Base URL or API key field', () => {
  vi.stubEnv('VITE_IS_PLATFORM', 'true');
  writeUserPreference('uiPreferences', { voiceEnabled: true });
  render(<UiPreferencesProvider><VoiceSettingsTab /></UiPreferencesProvider>);
  expect(screen.queryByPlaceholderText('https://api.openai.com/v1')).toBeNull();
  expect(screen.queryByPlaceholderText('sk-…')).toBeNull();
  expect(document.body.textContent).not.toContain('sk-builder-typed');
});

test('outside platform mode the backend fields are still there', () => {
  vi.stubEnv('VITE_IS_PLATFORM', 'false');
  writeUserPreference('uiPreferences', { voiceEnabled: true });
  render(<UiPreferencesProvider><VoiceSettingsTab /></UiPreferencesProvider>);
  expect(screen.getByPlaceholderText('https://api.openai.com/v1')).toBeTruthy();
});
