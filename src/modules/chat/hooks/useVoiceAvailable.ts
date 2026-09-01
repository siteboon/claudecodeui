import { useEffect, useState } from 'react';

import { api } from '@/shared/api';
import { useUiPreferences } from '@/shared/context/UiPreferencesContext';
import { readVoiceConfig, VOICE_CONFIG_SYNC_EVENT } from '@/shared/voiceConfig';

import { isSpeechRecognitionSupported } from '@/modules/chat/hooks/useSpeechRecognition';

// Voice UI is gated on the `voiceEnabled` UI preference (toggled in Quick Settings /
// the Settings modal) and a configured voice backend.
let healthRequest: Promise<boolean> | null = null;

function checkVoiceHealth(): Promise<boolean> {
  if (healthRequest) return healthRequest;
  const request = api.voice.health()
    .then(async (response) => {
      if (!response.ok) throw new Error(`Voice health check failed (${response.status})`);
      const data = await response.json();
      return data?.configured === true;
    })
    .finally(() => {
      healthRequest = null;
    });
  healthRequest = request;
  return request;
}

export function useVoiceAvailable(): boolean {
  // Read through the shared preferences owner. This used to re-parse the
  // preferences blob and register its own storage + sync listeners, once per
  // assistant message row.
  const { voiceEnabled: enabled } = useUiPreferences();
  const [available, setAvailable] = useState(false);

  useEffect(() => {
    let active = true;
    let requestId = 0;

    const check = async () => {
      if (!enabled) {
        setAvailable(false);
        return;
      }
      if (readVoiceConfig().baseUrl.trim()) {
        setAvailable(true);
        return;
      }
      const id = ++requestId;
      try {
        const result = await checkVoiceHealth();
        // Without a transcription backend the browser can still dictate, the
        // way the Claude Chrome extension does it - so the mic stays offered
        // rather than disappearing for want of an API key.
        if (active && id === requestId) setAvailable(result || isSpeechRecognitionSupported());
      } catch {
        if (active && id === requestId) setAvailable(isSpeechRecognitionSupported());
      }
    };

    void check();
    window.addEventListener(VOICE_CONFIG_SYNC_EVENT, check);
    return () => {
      active = false;
      window.removeEventListener(VOICE_CONFIG_SYNC_EVENT, check);
    };
  }, [enabled]);

  return enabled && available;
}

/**
 * Whether a transcription backend is actually reachable, as opposed to the mic
 * merely being offered. The composer needs the difference: with a backend it
 * records audio and posts it to /api/voice/transcribe, without one it lets the
 * browser do the recognising.
 */
export function useVoiceBackendReady(): boolean {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let active = true;

    const check = async () => {
      if (readVoiceConfig().baseUrl.trim()) {
        if (active) setReady(true);
        return;
      }

      try {
        const result = await checkVoiceHealth();
        if (active) setReady(result);
      } catch {
        if (active) setReady(false);
      }
    };

    void check();
    window.addEventListener(VOICE_CONFIG_SYNC_EVENT, check);
    return () => {
      active = false;
      window.removeEventListener(VOICE_CONFIG_SYNC_EVENT, check);
    };
  }, []);

  return ready;
}
