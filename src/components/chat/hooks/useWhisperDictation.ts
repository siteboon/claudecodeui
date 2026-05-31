import { useCallback, useRef, useState } from 'react';
import { authenticatedFetch } from '../../../utils/api';

type DictationState = 'idle' | 'recording' | 'transcribing' | 'error';

interface UseWhisperDictationOptions {
  onTranscription: (text: string) => void;
}

export function useWhisperDictation({ onTranscription }: UseWhisperDictationOptions) {
  const [state, setState] = useState<DictationState>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const startRecording = useCallback(async () => {
    try {
      setErrorMessage(null);
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm')
          ? 'audio/webm'
          : 'audio/ogg';

      const recorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        setState('transcribing');

        try {
          const blob = new Blob(chunksRef.current, { type: mimeType });
          const formData = new FormData();
          formData.append('audio', blob, 'audio.webm');

          const res = await authenticatedFetch('/api/transcribe', {
            method: 'POST',
            body: formData,
          });

          if (!res.ok) {
            const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
            throw new Error(err.error || `HTTP ${res.status}`);
          }

          const { text } = await res.json();
          if (text) onTranscription(text);
          setState('idle');
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          setErrorMessage(msg);
          setState('error');
          setTimeout(() => setState('idle'), 3000);
        }
      };

      recorder.start();
      setState('recording');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMessage(msg.includes('Permission') ? 'Microphone permission denied' : msg);
      setState('error');
      setTimeout(() => setState('idle'), 3000);
    }
  }, [onTranscription]);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current?.state === 'recording') {
      mediaRecorderRef.current.stop();
    }
  }, []);

  const toggleRecording = useCallback(() => {
    if (state === 'recording') {
      stopRecording();
    } else if (state === 'idle') {
      void startRecording();
    }
  }, [state, startRecording, stopRecording]);

  return { state, errorMessage, toggleRecording };
}
