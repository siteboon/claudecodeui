/**
 * The user's per-browser voice backend settings.
 *
 * These are plain localStorage readers with no React in them. They lived in
 * `hooks/useVoiceConfig` alongside the hook, which forced `shared/api.ts` — the
 * bottom of the dependency graph — to import upwards from the hooks layer just
 * to attach request headers.
 */

export type VoiceConfig = {
  baseUrl: string;
  apiKey: string;
  sttModel: string;
  ttsModel: string;
  ttsVoice: string;
  ttsFormat: string;
};

export const VOICE_CONFIG_STORAGE_KEY = 'voiceConfig';

/** Emitted on write, so open voice consumers re-read in the same tab. */
export const VOICE_CONFIG_SYNC_EVENT = 'voice-config:sync';

export const VOICE_CONFIG_DEFAULTS: VoiceConfig = {
  baseUrl: '',
  apiKey: '',
  sttModel: '',
  ttsModel: '',
  ttsVoice: '',
  ttsFormat: '',
};

export function readVoiceConfig(): VoiceConfig {
  try {
    const raw = localStorage.getItem(VOICE_CONFIG_STORAGE_KEY);
    if (!raw) return { ...VOICE_CONFIG_DEFAULTS };
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { ...VOICE_CONFIG_DEFAULTS };
    }
    const config = { ...VOICE_CONFIG_DEFAULTS };
    for (const key of Object.keys(VOICE_CONFIG_DEFAULTS) as (keyof VoiceConfig)[]) {
      if (typeof parsed[key] === 'string') config[key] = parsed[key];
    }
    return config;
  } catch {
    return { ...VOICE_CONFIG_DEFAULTS };
  }
}

// Headers the voice proxy reads to target a per-user OpenAI-compatible backend.
// Empty fields are omitted so the server's env defaults apply.
export function voiceConfigHeaders(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  const c = readVoiceConfig();
  const h: Record<string, string> = {};
  if (c.apiKey) h['x-voice-api-key'] = c.apiKey;
  if (c.sttModel) h['x-voice-stt-model'] = c.sttModel;
  if (c.ttsModel) h['x-voice-tts-model'] = c.ttsModel;
  if (c.ttsVoice) h['x-voice-tts-voice'] = c.ttsVoice;
  if (c.ttsFormat.trim()) h['x-voice-tts-format'] = c.ttsFormat.trim();
  return h;
}
