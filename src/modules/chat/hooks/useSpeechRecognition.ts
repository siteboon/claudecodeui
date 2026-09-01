import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Dictation through the browser's own speech recognition.
 *
 * The fallback for having no transcription backend. `/api/voice/transcribe`
 * needs `VOICE_API_BASE_URL` and `VOICE_API_KEY` pointing at a
 * whisper-compatible service, and without them `/api/voice/health` answers
 * `{"configured": false}` - which hides the mic button entirely.
 *
 * The Claude Chrome extension has no such backend either and dictates anyway,
 * because the browser can do it:
 *
 *     m = "undefined" != typeof window
 *         && ("SpeechRecognition" in window || "webkitSpeechRecognition" in window)
 *
 * Same interface here. Chromium ships it, so an Electron window has it too -
 * but it can be absent in a build without the speech key, which is why every
 * caller has to check `supported` rather than assume it.
 */

type SpeechRecognitionEventLike = {
  resultIndex: number;
  results: {
    length: number;
    [index: number]: { isFinal: boolean; 0: { transcript: string } };
  };
};

type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
};

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

function getConstructor(): SpeechRecognitionConstructor | null {
  if (typeof window === 'undefined') {
    return null;
  }

  const holder = window as unknown as {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };

  return holder.SpeechRecognition ?? holder.webkitSpeechRecognition ?? null;
}

export function isSpeechRecognitionSupported(): boolean {
  return getConstructor() !== null;
}

export type SpeechState = 'idle' | 'recording';

/**
 * Recognition runs while the button is held and hands over what was understood
 * when it stops - the same shape `useVoiceInput` has, so the composer can use
 * either without knowing which one it got.
 */
export function useSpeechRecognition(
  onTranscript: (text: string, send?: boolean) => void,
  onError?: (message: string) => void,
) {
  const [state, setState] = useState<SpeechState>('idle');
  const recognition = useRef<SpeechRecognitionLike | null>(null);
  const finalText = useRef('');
  const sendOnEnd = useRef(false);

  // A recognition left running would keep the microphone open after the
  // composer is gone.
  useEffect(() => () => {
    recognition.current?.abort();
    recognition.current = null;
  }, []);

  const start = useCallback(() => {
    if (recognition.current) {
      return;
    }

    const Recognition = getConstructor();
    if (!Recognition) {
      onError?.('This browser has no speech recognition.');
      return;
    }

    const instance = new Recognition();
    // The page language, so a German window dictates German.
    instance.lang = document.documentElement.lang || navigator.language || 'en-US';
    instance.continuous = true;
    instance.interimResults = true;
    finalText.current = '';
    sendOnEnd.current = false;

    instance.onresult = (event) => {
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        if (result.isFinal) {
          finalText.current += result[0].transcript;
        }
      }
    };

    instance.onerror = (event) => {
      const code = event.error ?? '';
      if (code === 'not-allowed' || code === 'service-not-allowed') {
        onError?.('Microphone access denied.');
      } else if (code && code !== 'no-speech' && code !== 'aborted') {
        onError?.(`Speech recognition failed: ${code}`);
      }
    };

    instance.onend = () => {
      recognition.current = null;
      setState('idle');

      const text = finalText.current.trim();
      if (text) {
        onTranscript(text, sendOnEnd.current);
      } else {
        onError?.('No speech detected');
      }
    };

    try {
      instance.start();
      recognition.current = instance;
      setState('recording');
    } catch (error) {
      recognition.current = null;
      setState('idle');
      onError?.(error instanceof Error ? error.message : String(error));
    }
  }, [onError, onTranscript]);

  const stop = useCallback((options?: { send?: boolean }) => {
    if (!recognition.current) {
      return;
    }

    // Read in `onend`, which is where the transcript is complete.
    sendOnEnd.current = options?.send ?? false;
    recognition.current.stop();
  }, []);

  const toggle = useCallback(() => {
    if (state === 'recording') {
      stop();
    } else {
      start();
    }
  }, [state, start, stop]);

  return { state, start, stop, toggle };
}
