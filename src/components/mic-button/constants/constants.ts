import type { MicButtonState } from '../types/types';

export const MIC_BUTTON_STATES = {
  IDLE: 'idle',
  RECORDING: 'recording',
  TRANSCRIBING: 'transcribing',
  PROCESSING: 'processing',
} as const;

export const MIC_TAP_DEBOUNCE_MS = 300;
export const PROCESSING_STATE_DELAY_MS = 2000;

export const DEFAULT_WHISPER_MODE = 'default';

// Modes that use post-transcription enhancement on the backend.
export const ENHANCEMENT_WHISPER_MODES = new Set([
  'prompt',
  'vibe',
  'instructions',
  'architect',
]);

export const BUTTON_BACKGROUND_BY_STATE: Record<MicButtonState, string> = {
  idle: '#374151',
  recording: '#ef4444',
  transcribing: '#3b82f6',
  processing: '#a855f7',
};

export const MIC_ERROR_BY_NAME = {
  NotAllowedError: 'Microphone access denied. Please allow microphone permissions.',
  NotFoundError: 'No microphone found. Please check your audio devices.',
  NotSupportedError: 'Microphone not supported by this browser.',
  NotReadableError: 'Microphone is being used by another application.',
} as const;

export const MIC_NOT_AVAILABLE_ERROR =
  'Microphone access not available. Please use HTTPS or a supported browser.';

export const MIC_NOT_SUPPORTED_ERROR =
  'Microphone not supported. Please use HTTPS or a modern browser.';

export const MIC_SECURE_CONTEXT_ERROR =
  'Microphone requires HTTPS. Please use a secure connection.';

