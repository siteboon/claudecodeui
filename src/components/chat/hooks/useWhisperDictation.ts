import { useCallback, useRef, useState } from 'react';
import { loadWhisperSettings } from '../../settings/view/tabs/VoiceSettingsTab';

type DictationState = 'idle' | 'recording' | 'transcribing' | 'error';

interface UseWhisperDictationOptions {
  onTranscription: (text: string) => void;
}

export function useWhisperDictation({ onTranscription }: UseWhisperDictationOptions) {
  const [state, setState] = useState<DictationState>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const setError = useCallback((msg: string) => {
    console.error('[Whisper STT]', msg);
    setErrorMessage(msg);
    setState('error');
    setTimeout(() => setState('idle'), 4000);
  }, []);

  const startRecording = useCallback(async () => {
    try {
      setErrorMessage(null);
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      const { url } = loadWhisperSettings();
      const wsUrl = url.replace(/^https:\/\//, 'wss://').replace(/^http:\/\//, 'ws://') + '/voice/stt';

      const ws = new WebSocket(wsUrl);
      ws.binaryType = 'arraybuffer';
      wsRef.current = ws;
      chunksRef.current = [];

      ws.onerror = () => {
        stream.getTracks().forEach((t) => t.stop());
        setError('WebSocket failed — check Voice settings URL');
      };

      ws.onopen = () => {
        const mimeType = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : '';
        const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
        mediaRecorderRef.current = recorder;

        recorder.ondataavailable = (e) => {
          if (e.data.size > 0) chunksRef.current.push(e.data);
        };

        recorder.onstop = async () => {
          stream.getTracks().forEach((t) => t.stop());
          setState('transcribing');

          try {
            const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' });
            const arrayBuffer = await blob.arrayBuffer();

            if (ws.readyState === WebSocket.OPEN) {
              ws.send(arrayBuffer);
              ws.send('__end__');
            } else {
              setError('WebSocket closed before audio was sent');
            }
          } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
          }
        };

        ws.onmessage = (ev) => {
          try {
            const data = JSON.parse(ev.data as string) as { text?: string; language?: string; confidence?: number; error?: string };
            if (data.error) {
              setError(`Service error: ${data.error}`);
              return;
            }
            const text = (data.text || '').trim();
            console.log('[Whisper STT] result:', { text, language: data.language, confidence: data.confidence });
            if (text) onTranscription(text);
            setState('idle');
          } catch {
            setError('Invalid response from voice service');
          }
          ws.close();
          wsRef.current = null;
        };

        recorder.start(); // no timeslice — produces a single well-formed WebM file
        setState('recording');
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg.includes('Permission') ? 'Microphone permission denied' : msg);
    }
  }, [onTranscription, setError]);

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
