import { beforeEach, expect, test, vi } from 'vitest';

import { i18n } from '@/modules/i18n';
import { checkVoiceHealth, resetVoiceHealth, voiceModeSendOption } from '@/modules/chat/voice/voiceState';
import { fakeResponse, setUiPreferences } from '@/modules/chat/voice/tests/kit';
import { resetUserPreferences } from '@/shared/userSettings';
import type * as SharedApi from '@/shared/api';

const h = vi.hoisted(() => ({ health: vi.fn() }));

vi.mock('@/shared/api', async (importOriginal) => {
  const actual = await importOriginal<typeof SharedApi>();
  return {
    ...actual,
    api: { ...actual.api, voice: { ...actual.api.voice, health: () => h.health() } },
  };
});

beforeEach(async () => {
  localStorage.clear();
  resetUserPreferences();
  resetVoiceHealth();
  h.health.mockReset();
  h.health.mockImplementation(async () => fakeResponse(200, { configured: true }));
});

test('with auto-speak off chat.send carries no voiceMode', async () => {
  await setUiPreferences({ voiceEnabled: true, autoSpeak: false });
  await checkVoiceHealth();
  expect(voiceModeSendOption()).toEqual({});
});

test('with voice unconfigured chat.send carries no voiceMode', async () => {
  h.health.mockImplementation(async () => fakeResponse(200, { configured: false }));
  await setUiPreferences({ voiceEnabled: true, autoSpeak: true });
  await checkVoiceHealth();
  expect(voiceModeSendOption()).toEqual({});
});

test('with auto-speak active chat.send asks for the spoken line in the UI language', async () => {
  await setUiPreferences({ voiceEnabled: true, autoSpeak: true });
  await checkVoiceHealth();
  await i18n.changeLanguage('cs');
  expect(voiceModeSendOption()).toEqual({ voiceMode: { language: 'cs' } });
  await i18n.changeLanguage('en');
  expect(voiceModeSendOption()).toEqual({ voiceMode: { language: 'en' } });
});
