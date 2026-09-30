import { useEffect, useState } from 'react';

import { useUiPreferences } from '@/shared/context/UiPreferencesContext';
import { readVoiceConfig, VOICE_CONFIG_SYNC_EVENT } from '@/shared/voiceConfig';
// The health check lives with the voice overlay, which remembers the last answer
// so the socket handler can read it synchronously when a turn completes.
import { checkVoiceHealth } from '@/modules/chat/voice/voiceState';

// Voice UI is gated on the `voiceEnabled` UI preference (toggled in Quick Settings /
// the Settings modal) and a configured voice backend.

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
