import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import VoiceSettingsTab from '@/modules/settings/tabs/VoiceSettingsTab';
import { synthesizeVoice, transcribeVoice } from '@/shared/api';
import { UiPreferencesProvider } from '@/shared/context/UiPreferencesContext';
import { resetUserPreferences, writeUserPreference } from '@/shared/userSettings';
import { readVoiceConfig, voiceConfigHeaders, VOICE_CONFIG_DEFAULTS } from '@/shared/voiceConfig';

/**
 * KTD7: in platform mode, voice settings typed in the browser - including ones
 * stored before the overlay existed - must not open a direct path to a vendor
 * or ride along as `x-voice-*` override headers, and the settings tab must not
 * offer them.
 */

const VENDOR = 'https://vendor.example/v1';

const seedBrowserConfig = () => {
  localStorage.setItem('voiceConfig', JSON.stringify({
    baseUrl: VENDOR,
    apiKey: 'sk-builder-typed',
    sttModel: 'whisper-1',
    ttsModel: 'tts-1',
    ttsVoice: 'alloy',
    ttsFormat: 'mp3',
  }));
};

type Call = { url: string; headers: Record<string, string> };
let calls: Call[];

beforeEach(() => {
  localStorage.clear();
  resetUserPreferences();
  calls = [];
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((value, key) => {
      headers[key.toLowerCase()] = value;
    });
    calls.push({ url: String(input), headers });
    return new Response(JSON.stringify({ configured: true }), { status: 200 });
  }));
  seedBrowserConfig();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('platform mode', () => {
  test('readVoiceConfig returns the defaults and no x-voice-* header is built', () => {
    vi.stubEnv('VITE_IS_PLATFORM', 'true');
    expect(readVoiceConfig()).toEqual(VOICE_CONFIG_DEFAULTS);
    expect(voiceConfigHeaders()).toEqual({});
  });

  test('speech and transcription go to the relay only, with no override header', async () => {
    vi.stubEnv('VITE_IS_PLATFORM', 'true');
    await synthesizeVoice('Hotovo.', new AbortController().signal);
    await transcribeVoice(new Blob(['x']), 'recording.webm');
    expect(calls.map((c) => c.url)).toEqual(['/api/voice/tts', '/api/voice/transcribe']);
    for (const call of calls) {
      expect(call.url.startsWith(VENDOR)).toBe(false);
      expect(Object.keys(call.headers).filter((k) => k.startsWith('x-voice-'))).toEqual([]);
    }
  });

  test('the settings tab renders no Base URL or API key field', () => {
    vi.stubEnv('VITE_IS_PLATFORM', 'true');
    writeUserPreference('uiPreferences', { voiceEnabled: true });
    render(<UiPreferencesProvider><VoiceSettingsTab /></UiPreferencesProvider>);
    expect(screen.queryByPlaceholderText('https://api.openai.com/v1')).toBeNull();
    expect(screen.queryByPlaceholderText('sk-…')).toBeNull();
    expect(document.body.textContent).not.toContain('sk-builder-typed');
  });

  test('outside platform mode the upstream behaviour is unchanged', async () => {
    vi.stubEnv('VITE_IS_PLATFORM', 'false');
    expect(readVoiceConfig().baseUrl).toBe(VENDOR);
    await synthesizeVoice('Hotovo.', new AbortController().signal);
    expect(calls[0].url).toBe(`${VENDOR}/audio/speech`);
  });
});
