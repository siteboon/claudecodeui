import { useCallback, useEffect, useRef, useState } from 'react';
import { authenticatedFetch } from '../../../utils/api';
import { voiceConfigHeaders } from '../../../hooks/useVoiceConfig';

// Only one message speaks at a time across the whole app.
let stopActive: (() => void) | null = null;

export type TtsState = 'idle' | 'loading' | 'playing';

/**
 * Tap-to-speak for a single message. Sends raw markdown to /api/voice/tts and plays
 * the returned audio. Manual-gesture only (v1) to satisfy iOS autoplay. Exposes the
 * last error (e.g. a backend timeout) so the control can surface it.
 */
export function useTts(getText: () => string) {
  const [state, setState] = useState<TtsState>('idle');
  const [error, setError] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlRef = useRef<string | null>(null);
  const errorTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  const showError = useCallback((msg: string) => {
    setError(msg);
    if (errorTimer.current) clearTimeout(errorTimer.current);
    errorTimer.current = setTimeout(() => setError(null), 6000);
  }, []);

  // Cleanup on unmount: drop the global stop handler if it points at us, then reset.
  useEffect(
    () => () => {
      if (stopActive === stop) stopActive = null;
      if (errorTimer.current) clearTimeout(errorTimer.current);
      reset();
    },
    [reset, stop],
  );

  const play = useCallback(async () => {
    if (stopActive) stopActive();
    const text = getText();
    if (!text || !text.trim()) return;
    setError(null);

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
      if (!res.ok) {
        let msg = `Read-aloud failed (${res.status})`;
        try {
          const j = await res.json();
          if (j?.error) msg = String(j.error);
        } catch {
          /* non-JSON error body */
        }
        throw new Error(msg);
      }
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
    } catch (e) {
      reset();
      setState('idle');
      showError(e instanceof Error ? e.message : 'Read-aloud failed');
    }
  }, [getText, reset, stop, showError]);

  const toggle = useCallback(() => {
    if (state === 'playing' || state === 'loading') stop();
    else play();
  }, [state, play, stop]);

  return { state, toggle, error };
}
