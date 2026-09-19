import { useCallback, useEffect, useState } from 'react';

import { autoSpeakSessions } from '@/modules/chat/utils/autoSpeakSessions';
import { voicePlayer } from '@/modules/chat/utils/voicePlayer';

/**
 * Reflects and flips one session's auto read-aloud setting. Thin adapter over the
 * app-level store, in the same shape as useTts.
 */
export function useAutoSpeak(sessionId: string | null) {
  const [enabled, setEnabled] = useState(() => autoSpeakSessions.isEnabled(sessionId));

  useEffect(() => {
    const sync = () => setEnabled(autoSpeakSessions.isEnabled(sessionId));
    sync();
    const unsubscribe = autoSpeakSessions.subscribe(sync);
    if (sessionId) void autoSpeakSessions.load(sessionId);
    return unsubscribe;
  }, [sessionId]);

  const toggle = useCallback(() => {
    if (!sessionId) return;
    // Inside the click, the only moment iOS grants the shared <audio> element
    // permission to play; auto read-aloud has no gesture of its own.
    voicePlayer.unlock();
    autoSpeakSessions.toggle(sessionId);
  }, [sessionId]);

  return { enabled, toggle };
}
