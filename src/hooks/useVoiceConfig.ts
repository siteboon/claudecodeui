import { useState } from 'react';

export type VoiceConfig = {
  baseUrl: string;
  apiKey: string;
  sttModel: string;
  ttsModel: string;
  ttsVoice: string;
  ttsFormat: string;
};

const STORAGE_KEY = 'voiceConfig';
const DEFAULTS: VoiceConfig = { baseUrl: '', apiKey: '', sttModel: '', ttsModel: '', ttsVoice: '', ttsFormat: 'mp3' };

function read(): VoiceConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw);
    const next = { ...DEFAULTS, ...(parsed && typeof parsed === 'object' ? parsed : {}) };
    if (!next.ttsFormat) next.ttsFormat = DEFAULTS.ttsFormat;
    return next;
  } catch {
    return { ...DEFAULTS };
  }
}

// Headers the voice proxy reads to target a per-user OpenAI-compatible backend.
// Empty fields are omitted so the server's env defaults apply.
export function voiceConfigHeaders(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  const c = read();
  const h: Record<string, string> = {};
  if (c.baseUrl) h['x-voice-base-url'] = c.baseUrl;
  if (c.apiKey) h['x-voice-api-key'] = c.apiKey;
  if (c.sttModel) h['x-voice-stt-model'] = c.sttModel;
  if (c.ttsModel) h['x-voice-tts-model'] = c.ttsModel;
  if (c.ttsVoice) h['x-voice-tts-voice'] = c.ttsVoice;
  if (c.ttsFormat) h['x-voice-tts-format'] = c.ttsFormat;
  return h;
}

export function useVoiceConfig() {
  const [config, setConfig] = useState<VoiceConfig>(() =>
    typeof window === 'undefined' ? { ...DEFAULTS } : read(),
  );

  const update = (patch: Partial<VoiceConfig>) => {
    setConfig((prev) => {
      const next = { ...prev, ...patch };
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        /* ignore persistence errors */
      }
      return next;
    });
  };

  return { config, update };
}
