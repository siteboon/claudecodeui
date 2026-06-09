import { useCallback, useEffect, useRef, useState } from 'react';
import { authenticatedFetch } from '../../../utils/api';
import { voiceConfigHeaders } from '../../../hooks/useVoiceConfig';

// Only one message speaks at a time across the whole app.
let stopActive: (() => void) | null = null;

export type TtsState = 'idle' | 'loading' | 'playing';

/**
 * Tap-to-speak for a single message. Sends raw markdown to /api/voice/tts
 * (Kokoro sidecar via the Express proxy; cleaning happens server-side),
 * plays the returned audio. Manual-gesture only (v1) to satisfy iOS autoplay.
 */
export function useTts(getText: () => string) {
  const [state, setState] = useState<TtsState>('idle');
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlRef = useRef<string | null>(null);

  const reset = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.onended = null;
      audioRef.current.onerror = null;
      audioRef.current.pause();
      audioRef.current.src = '';
      audioRef.current = null;
    }
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    }
  }, []);

  const stop = useCallback(() => {
    reset();
    setState('idle');
    if (stopActive) stopActive = null;
  }, [reset]);

  // Cleanup on unmount: drop the global stop handler if it points at us, then reset.
  useEffect(
    () => () => {
      if (stopActive === stop) stopActive = null;
      reset();
    },
    [reset, stop],
  );

  const play = useCallback(async () => {
    if (stopActive) stopActive();
    const text = getText();
    if (!text || !text.trim()) return;

    // Create + "unlock" the audio element synchronously inside the click gesture,
    // so iOS Safari lets us play it after the async fetch resolves.
    const audio = new Audio();
    audioRef.current = audio;
    audio.onended = () => stop();
    audio.onerror = () => stop();
    try {
      audio.play().catch(() => {});
      audio.pause();
    } catch {
      /* unlock attempt; ignore */
    }
    stopActive = stop;
    setState('loading');

    try {
      const res = await authenticatedFetch('/api/voice/tts', {
        method: 'POST',
        body: JSON.stringify({ text }),
        headers: voiceConfigHeaders(),
      });
      if (!res.ok) throw new Error(`tts ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      if (audioRef.current !== audio) {
        URL.revokeObjectURL(url); // stopped while loading; don't leak the blob URL
        return;
      }
      urlRef.current = url;
      audio.src = url;
      audio.load();
      await audio.play();
      setState('playing');
    } catch {
      reset();
      setState('idle');
    }
  }, [getText, reset, stop]);

  const toggle = useCallback(() => {
    if (state === 'playing' || state === 'loading') stop();
    else play();
  }, [state, play, stop]);

  return { state, toggle };
}
