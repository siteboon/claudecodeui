import { useCallback, useEffect, useRef, useState } from 'react';

import { transcribeVoice } from '@/shared/api';
import type { VoiceInputState } from '@/shared/types';
import { voicePlayer } from '@/modules/chat/utils/voicePlayer';
import { currentDictationScope, MAX_RECORDING_MS } from '@/modules/chat/voice/dictation';
import { announceVoice } from '@/modules/chat/voice/voiceUiStore';
import {
  classifyMicError,
  micErrorKey,
  voiceErrorFromException,
  voiceErrorFromResponse,
  voiceErrorKey,
  VoiceRequestError,
} from '@/modules/chat/voice/voiceErrors';

// A recording that failed to transcribe is kept for exactly one retry.
type Clip = { blob: Blob; filename: string; send: boolean; origin: string | null };

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


/**
 * Push-to-talk dictation. Records the mic, uploads to /api/voice/transcribe
 * (an OpenAI-compatible speech-to-text backend via the Express proxy), and
 * returns the transcript through onTranscript.
 *
 * `onError` receives a translation key in the `voice` namespace, never raw text.
 * The transcript carries the composer scope the recording STARTED in.
 */
export function useVoiceInput(
  onTranscript: (text: string, send?: boolean, origin?: string | null) => void,
  onError?: (msg: string) => void,
) {
  const [state, setState] = useState<VoiceInputState>('idle');
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const cancelledRef = useRef(false);
  const startingRef = useRef(false);
  // Whether the in-progress stop should auto-send the transcript (vs just fill the box).
  const sendRef = useRef(false);
  const originRef = useRef<string | null>(null);
  const failedClipRef = useRef<Clip | null>(null);
  const autoStopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [canRetry, setCanRetry] = useState(false);
  const [startedAt, setStartedAt] = useState<number | null>(null);

  const clearAutoStop = () => {
    if (autoStopTimerRef.current) clearTimeout(autoStopTimerRef.current);
    autoStopTimerRef.current = null;
  };

  const transcribe = useCallback(async (clip: Clip, isRetry: boolean) => {
    setState('transcribing');
    try {
      const res = await transcribeVoice(clip.blob, clip.filename);
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new VoiceRequestError(voiceErrorFromResponse(res.status, body));
      }
      const data = await res.json();
      if (cancelledRef.current) return;
      failedClipRef.current = null;
      setCanRetry(false);
      const text = String(data?.text || '').trim();
      if (text) onTranscript(text, clip.send, clip.origin);
      else onError?.('dictation.noSpeech');
    } catch (e) {
      if (cancelledRef.current) return;
      if (isRetry) {
        failedClipRef.current = null;
        setCanRetry(false);
        onError?.('dictation.failedDiscarded');
      } else {
        failedClipRef.current = { ...clip, send: false };
        setCanRetry(true);
        onError?.(voiceErrorKey(voiceErrorFromException(e)));
        announceVoice('dictation.failedWithRetry');
      }
    } finally {
      if (!cancelledRef.current) setState('idle');
    }
  }, [onTranscript, onError]);

  const stopTracks = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  };

  // Stop the mic if the component unmounts mid-recording.
  useEffect(() => {
    cancelledRef.current = false;
    return () => {
      cancelledRef.current = true;
      startingRef.current = false;
      clearAutoStop();
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      recorderRef.current = null;
    };
  }, []);

  const start = useCallback(async () => {
    if (startingRef.current || (recorderRef.current && recorderRef.current.state !== 'inactive')) return;
    startingRef.current = true;
    // Silence a reply before the mic opens: it stops the audio and keeps it out of the clip.
    voicePlayer.stop();
    // A new recording replaces a clip kept for retry.
    failedClipRef.current = null;
    setCanRetry(false);
    originRef.current = currentDictationScope();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      if (cancelledRef.current) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
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
        clearAutoStop();
        setStartedAt(null);
        if (cancelledRef.current) return;
        // Capture and clear the send intent for this stop before any async work.
        const shouldSend = sendRef.current;
        sendRef.current = false;
        const type = rec.mimeType || 'audio/webm';
        const blob = new Blob(chunksRef.current, { type });
        if (blob.size < 800) {
          setState('idle');
          onError?.('dictation.tooShort');
          return;
        }
        const ext = type.includes('mp4') ? 'm4a' : type.includes('ogg') ? 'ogg' : 'webm';
        await transcribe({ blob, filename: `recording.${ext}`, send: shouldSend, origin: originRef.current }, false);
      };

      rec.start();
      setState('recording');
      setStartedAt(Date.now());
      announceVoice('dictation.recording');
      // A forgotten open mic stops itself; the transcript fills the box, never sends.
      autoStopTimerRef.current = setTimeout(() => {
        if (rec.state !== 'inactive') {
          sendRef.current = false;
          rec.stop();
          announceVoice('dictation.autoStopped');
        }
      }, MAX_RECORDING_MS);
    } catch (e) {
      recorderRef.current = null;
      stopTracks();
      if (cancelledRef.current) return;
      onError?.(micErrorKey(classifyMicError(e)));
      setState('idle');
    } finally {
      startingRef.current = false;
    }
  }, [onError, transcribe]);

  // Stop recording. Pass { send: true } to auto-send the transcript once it's ready.
  // Guard on the recorder's own state (not React state) so a double tap, or the mic
  // and Send buttons both firing, can't call stop() on an already-inactive recorder.
  const stop = useCallback((opts?: { send?: boolean }) => {
    const rec = recorderRef.current;
    if (rec && rec.state !== 'inactive') {
      sendRef.current = opts?.send ?? false;
      rec.stop();
    }
  }, []);

  const toggle = useCallback(() => {
    if (state === 'recording') stop();
    else if (state === 'idle') start();
  }, [state, start, stop]);

  // Re-sends the kept clip - the same bytes - once. A second failure discards it.
  const retry = useCallback(() => {
    const clip = failedClipRef.current;
    if (!clip || state !== 'idle') return;
    void transcribe(clip, true);
  }, [state, transcribe]);

  return { state, toggle, stop, canRetry, retry, startedAt };
}
