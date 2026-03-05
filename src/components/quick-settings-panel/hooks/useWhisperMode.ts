import { useCallback, useState } from 'react';
import {
  VIBE_MODE_ALIASES,
  WHISPER_MODE_CHANGED_EVENT,
  WHISPER_MODE_STORAGE_KEY,
} from '../constants';
import type { WhisperMode, WhisperOptionValue } from '../types';

const ALL_VALID_MODES: WhisperMode[] = [
  'default',
  'prompt',
  'vibe',
  'instructions',
  'architect',
];

const isWhisperMode = (value: string): value is WhisperMode => (
  ALL_VALID_MODES.includes(value as WhisperMode)
);

const readStoredMode = (): WhisperMode => {
  if (typeof window === 'undefined') {
    return 'default';
  }

  const storedValue = localStorage.getItem(WHISPER_MODE_STORAGE_KEY);
  if (!storedValue) {
    return 'default';
  }

  return isWhisperMode(storedValue) ? storedValue : 'default';
};

export function useWhisperMode() {
  const [whisperMode, setWhisperModeState] = useState<WhisperMode>(readStoredMode);

  const setWhisperMode = useCallback((value: WhisperOptionValue) => {
    setWhisperModeState(value);
    localStorage.setItem(WHISPER_MODE_STORAGE_KEY, value);
    window.dispatchEvent(new Event(WHISPER_MODE_CHANGED_EVENT));
  }, []);

  const isOptionSelected = useCallback(
    (value: WhisperOptionValue) => {
      if (value === 'vibe') {
        return VIBE_MODE_ALIASES.includes(whisperMode);
      }

      return whisperMode === value;
    },
    [whisperMode],
  );

  return {
    whisperMode,
    setWhisperMode,
    isOptionSelected,
  };
}
