import { useEffect, useSyncExternalStore } from 'react';

import { api } from '@/shared/api';
import { useUiPreferences } from '@/shared/context/UiPreferencesContext';
import { readStoredUiPreferences } from '@/shared/uiPreferences';
import { readVoiceConfig, VOICE_CONFIG_SYNC_EVENT } from '@/shared/voiceConfig';

/**
 * Where voice stands, readable both synchronously (the socket handler decides
 * at `complete`, outside React) and as a hook (the controls).
 *
 * Nothing here touches the network while the upstream `voiceEnabled` toggle is
 * off: a workspace that never switched voice on keeps its request pattern.
 */

/** Platform mode (the hosted build): voice settings typed in the browser are ignored. */
export const isVoicePlatformMode = (): boolean => import.meta.env?.VITE_IS_PLATFORM === 'true';

// --- relay health: one in-flight request, last answer remembered ------------

let lastHealth: boolean | null = null;
let healthRequest: Promise<boolean> | null = null;
const healthListeners = new Set<() => void>();

const setHealth = (value: boolean | null) => {
  if (lastHealth === value) return;
  lastHealth = value;
  healthListeners.forEach((listener) => listener());
};

export function checkVoiceHealth(): Promise<boolean> {
  if (healthRequest) return healthRequest;
  const request = api.voice.health()
    .then(async (response) => {
      if (!response.ok) throw new Error(`Voice health check failed (${response.status})`);
      const data = await response.json();
      const configured = data?.configured === true;
      setHealth(configured);
      return configured;
    })
    .catch((error) => {
      setHealth(false);
      throw error;
    })
    .finally(() => {
      healthRequest = null;
    });
  healthRequest = request;
  return request;
}

export const voiceHealth = (): boolean | null => lastHealth;

export function subscribeVoiceHealth(listener: () => void): () => void {
  healthListeners.add(listener);
  return () => {
    healthListeners.delete(listener);
  };
}

/** Test seam. */
export function resetVoiceHealth(): void {
  lastHealth = null;
  healthRequest = null;
}

// --- synchronous reads for the socket handler and the request site ---------

const hasDirectBackend = () => !isVoicePlatformMode() && readVoiceConfig().baseUrl.trim().length > 0;

/** `voiceEnabled` is on and a backend is configured (a direct URL, or the relay reports one). */
export function isVoiceConfigured(): boolean {
  if (!readStoredUiPreferences().voiceEnabled) return false;
  return hasDirectBackend() || lastHealth === true;
}

/** Auto-speak may fire: the preference is on and voice is configured (KTD8). */
export function isAutoSpeakActive(): boolean {
  return readStoredUiPreferences().autoSpeak === true && isVoiceConfigured();
}

// --- the hook the controls use ----------------------------------------------

export type VoiceStatus = 'off' | 'checking' | 'unavailable' | 'available';

/**
 * `off` renders nothing (upstream's toggle is off), `unavailable` renders the
 * controls disabled with an explanation instead of hiding them.
 */
export function useVoiceStatus(): VoiceStatus {
  const { voiceEnabled } = useUiPreferences();
  const health = useSyncExternalStore(subscribeVoiceHealth, voiceHealth, voiceHealth);

  useEffect(() => {
    if (!voiceEnabled) return undefined;
    const check = () => {
      if (hasDirectBackend()) return;
      void checkVoiceHealth().catch(() => undefined);
    };
    check();
    window.addEventListener(VOICE_CONFIG_SYNC_EVENT, check);
    return () => window.removeEventListener(VOICE_CONFIG_SYNC_EVENT, check);
  }, [voiceEnabled]);

  if (!voiceEnabled) return 'off';
  if (hasDirectBackend() || health === true) return 'available';
  if (health === false) return 'unavailable';
  return 'checking';
}
