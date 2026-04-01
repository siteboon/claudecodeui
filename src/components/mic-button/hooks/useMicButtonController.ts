import { useEffect, useRef, useState } from 'react';
import type { MouseEvent } from 'react';
import { transcribeWithWhisper } from '../data/whisper';
import {
  DEFAULT_WHISPER_MODE,
  ENHANCEMENT_WHISPER_MODES,
  MIC_BUTTON_STATES,
  MIC_ERROR_BY_NAME,
  MIC_NOT_AVAILABLE_ERROR,
  MIC_NOT_SUPPORTED_ERROR,
  MIC_SECURE_CONTEXT_ERROR,
  MIC_TAP_DEBOUNCE_MS,
  PROCESSING_STATE_DELAY_MS,
} from '../constants/constants';
import type { MicButtonState } from '../types/types';

type UseMicButtonControllerArgs = {
  onTranscript?: (transcript: string) => void;
};

type UseMicButtonControllerResult = {
  state: MicButtonState;
  error: string | null;
  isSupported: boolean;
  handleButtonClick: (event?: MouseEvent<HTMLButtonElement>) => void;
};

const getRecordingErrorMessage = (error: unknown): string => {
  if (error instanceof Error && error.message.includes('HTTPS')) {
    return error.message;
  }

  if (error instanceof DOMException) {
    return MIC_ERROR_BY_NAME[error.name as keyof typeof MIC_ERROR_BY_NAME] || 'Microphone access failed';
  }

  return 'Microphone access failed';
};

const getRecorderMimeType = (): string => (
  MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/mp4'
);

export function useMicButtonController({
  onTranscript,
}: UseMicButtonControllerArgs): UseMicButtonControllerResult {
  const [state, setState] = useState<MicButtonState>(MIC_BUTTON_STATES.IDLE);
  const [error, setError] = useState<string | null>(null);
  const [isSupported, setIsSupported] = useState(true);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const lastTapRef = useRef(0);
  const processingTimerRef = useRef<number | null>(null);

  const clearProcessingTimer = (): void => {
    if (processingTimerRef.current !== null) {
      window.clearTimeout(processingTimerRef.current);
      processingTimerRef.current = null;
    }
  };

  const stopStreamTracks = (): void => {
    if (!streamRef.current) {
      return;
    }

    streamRef.current.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  };

  const handleStopRecording = async (mimeType: string): Promise<void> => {
    const audioBlob = new Blob(chunksRef.current, { type: mimeType });

    // Release the microphone immediately once recording ends.
    stopStreamTracks();
    setState(MIC_BUTTON_STATES.TRANSCRIBING);

    const whisperMode = window.localStorage.getItem('whisperMode') || DEFAULT_WHISPER_MODE;
    const shouldShowProcessingState = ENHANCEMENT_WHISPER_MODES.has(whisperMode);

    if (shouldShowProcessingState) {
      processingTimerRef.current = window.setTimeout(() => {
        setState(MIC_BUTTON_STATES.PROCESSING);
      }, PROCESSING_STATE_DELAY_MS);
    }

    try {
      const transcript = await transcribeWithWhisper(audioBlob);
      if (transcript && onTranscript) {
        onTranscript(transcript);
      }
    } catch (transcriptionError) {
      const message = transcriptionError instanceof Error ? transcriptionError.message : 'Transcription error';
      setError(message);
    } finally {
      clearProcessingTimer();
      setState(MIC_BUTTON_STATES.IDLE);
    }
  };

  const startRecording = async (): Promise<void> => {
    try {
      setError(null);
      chunksRef.current = [];

      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error(MIC_NOT_AVAILABLE_ERROR);
      }

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const mimeType = getRecorderMimeType();
      const recorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (event: BlobEvent) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      recorder.onstop = () => {
        void handleStopRecording(mimeType);
      };

      recorder.start();
      setState(MIC_BUTTON_STATES.RECORDING);
    } catch (recordingError) {
      stopStreamTracks();
      setError(getRecordingErrorMessage(recordingError));
      setState(MIC_BUTTON_STATES.IDLE);
    }
  };

  const stopRecording = (): void => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop();
      return;
    }

    stopStreamTracks();
    setState(MIC_BUTTON_STATES.IDLE);
  };

  const handleButtonClick = (event?: MouseEvent<HTMLButtonElement>): void => {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }

    if (!isSupported) {
      return;
    }

    // Mobile tap handling can trigger duplicate click events in quick succession.
    const now = Date.now();
    if (now - lastTapRef.current < MIC_TAP_DEBOUNCE_MS) {
      return;
    }
    lastTapRef.current = now;

    if (state === MIC_BUTTON_STATES.IDLE) {
      void startRecording();
      return;
    }

    if (state === MIC_BUTTON_STATES.RECORDING) {
      stopRecording();
    }
  };

  useEffect(() => {
    // getUserMedia needs both browser support and a secure context.
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setIsSupported(false);
      setError(MIC_NOT_SUPPORTED_ERROR);
      return;
    }

    if (location.protocol !== 'https:' && location.hostname !== 'localhost') {
      setIsSupported(false);
      setError(MIC_SECURE_CONTEXT_ERROR);
      return;
    }

    setIsSupported(true);
    setError(null);
  }, []);

  useEffect(() => () => {
    clearProcessingTimer();
    stopStreamTracks();
  }, []);

  return {
    state,
    error,
    isSupported,
    handleButtonClick,
  };
}
