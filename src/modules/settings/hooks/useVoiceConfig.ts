import { useState } from 'react';

import type { VoiceConfig } from '@/shared/voiceConfig';
import {
  readVoiceConfig,
  VOICE_CONFIG_DEFAULTS,
  VOICE_CONFIG_STORAGE_KEY,
  VOICE_CONFIG_SYNC_EVENT,
} from '@/shared/voiceConfig';

export function useVoiceConfig() {
  const [config, setConfig] = useState<VoiceConfig>(() =>
    typeof window === 'undefined' ? { ...VOICE_CONFIG_DEFAULTS } : readVoiceConfig(),
  );

  const update = (patch: Partial<VoiceConfig>) => {
    setConfig((prev) => {
      const next = { ...prev, ...patch };
      try {
        const stored: Partial<VoiceConfig> = { ...next };
        if (next.ttsFormat.trim()) stored.ttsFormat = next.ttsFormat.trim();
        else delete stored.ttsFormat;
        localStorage.setItem(VOICE_CONFIG_STORAGE_KEY, JSON.stringify(stored));
        window.dispatchEvent(new Event(VOICE_CONFIG_SYNC_EVENT));
      } catch {
        /* ignore persistence errors */
      }
      return next;
    });
  };

  return { config, update };
}
