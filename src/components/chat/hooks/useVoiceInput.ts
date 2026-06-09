import { useCallback, useEffect, useRef, useState } from 'react';
import { authenticatedFetch } from '../../../utils/api';
import { voiceConfigHeaders } from '../../../hooks/useVoiceConfig';

// Mobile-safe recording: iOS Safari 18.4+ supports webm/opus; older iOS needs mp4.
const MIME_CANDIDATES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4',
  'audio/ogg;codecs=opus',
  'audio/ogg',
];

function pickMime(): string {
  for (const t of MIME_CANDIDATES) {
    try {
      if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t)) return t;
    } catch {
      /* isTypeSupported can throw on some iOS versions */
    }
  }
  return '';
}

export type VoiceInputState = 'idle' | 'recording' | 'transcribing';

/**
 * Push-to-talk dictation. Records the mic, uploads to /api/voice/transcribe
 * (faster-whisper sidecar via the Express proxy), returns text via onTranscript.
 * Ported from tooler's VoiceInput.js.
 */
export function useVoiceInput(onTranscript: (text: string) => void, onError?: (msg: string) => void) {
  const [state, setState] = useState<VoiceInputState>('idle');
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);

  const stopTracks = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  };

  // Stop the mic if the component unmounts mid-recording.
  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      recorderRef.current = null;
    };
  }, []);

  const start = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      streamRef.current = stream;
      const mimeType = pickMime();
      const rec = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      recorderRef.current = rec;
      chunksRef.current = [];

      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      rec.onstop = async () => {
        stopTracks();
        const type = rec.mimeType || 'audio/webm';
        const blob = new Blob(chunksRef.current, { type });
        if (blob.size < 800) {
          setState('idle');
          onError?.('Recording too short');
          return;
        }
        setState('transcribing');
        try {
          const ext = type.includes('mp4') ? 'm4a' : type.includes('ogg') ? 'ogg' : 'webm';
          const fd = new FormData();
          fd.append('audio', blob, `recording.${ext}`);
          const res = await authenticatedFetch('/api/voice/transcribe', {
            method: 'POST',
            body: fd,
            headers: voiceConfigHeaders(),
          });
          if (!res.ok) throw new Error(`transcribe ${res.status}`);
          const data = await res.json();
          const text = String(data?.text || '').trim();
          if (text) onTranscript(text);
          else onError?.('No speech detected');
        } catch (e) {
          onError?.(`Transcription failed: ${e instanceof Error ? e.message : String(e)}`);
        } finally {
          setState('idle');
        }
      };

      rec.start();
      setState('recording');
    } catch (e) {
      const err = e as { name?: string; message?: string };
      let msg = `Mic error: ${err?.message || e}`;
      if (err?.name === 'NotAllowedError') msg = 'Microphone access denied.';
      else if (err?.name === 'NotFoundError') msg = 'No microphone found.';
      onError?.(msg);
      setState('idle');
    }
  }, [onTranscript, onError]);

  const stop = useCallback(() => {
    if (recorderRef.current && state === 'recording') recorderRef.current.stop();
  }, [state]);

  const toggle = useCallback(() => {
    if (state === 'recording') stop();
    else if (state === 'idle') start();
  }, [state, start, stop]);

  return { state, toggle };
}
