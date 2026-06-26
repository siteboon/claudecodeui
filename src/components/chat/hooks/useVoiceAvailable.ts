import { useEffect, useState } from 'react';

import { authenticatedFetch } from '../../../utils/api';
import { readVoiceConfig, VOICE_CONFIG_SYNC_EVENT } from '../../../hooks/useVoiceConfig';

// Voice UI is gated on the `voiceEnabled` UI preference (toggled in Quick Settings /
// the Settings modal) and a configured voice backend.
const STORAGE_KEY = 'uiPreferences';
const SYNC_EVENT = 'ui-preferences:sync';
let healthRequest: Promise<boolean> | null = null;

function checkVoiceHealth(): Promise<boolean> {
  if (healthRequest) return healthRequest;
  const request = authenticatedFetch('/api/voice/health')
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

function readVoiceEnabled(): boolean {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw);
    return parsed?.voiceEnabled === true || parsed?.voiceEnabled === 'true';
  } catch {
    return false;
  }
}

export function useVoiceAvailable(): boolean {
  const [enabled, setEnabled] = useState<boolean>(() =>
    typeof window === 'undefined' ? false : readVoiceEnabled(),
  );
  const [available, setAvailable] = useState(false);

  useEffect(() => {
    const update = () => setEnabled(readVoiceEnabled());
    window.addEventListener('storage', update);
    window.addEventListener(SYNC_EVENT, update as EventListener);
    return () => {
      window.removeEventListener('storage', update);
      window.removeEventListener(SYNC_EVENT, update as EventListener);
    };
  }, []);

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
        if (active && id === requestId) setAvailable(result);
      } catch {
        if (active && id === requestId) setAvailable(false);
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
