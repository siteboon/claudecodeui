import { useEffect, useState } from 'react';

import {
  CODE_EDITOR_DEFAULTS,
  CODE_EDITOR_SETTINGS_CHANGED_EVENT,
  CODE_EDITOR_STORAGE_KEYS,
} from '@/shared/constants';

const readBoolean = (storageKey: string, defaultValue: boolean, falseValue = 'false') => {
  const value = localStorage.getItem(storageKey);
  if (value === null) {
    return defaultValue;
  }

  return value !== falseValue;
};

const readWordWrap = () => {
  return localStorage.getItem(CODE_EDITOR_STORAGE_KEYS.wordWrap) === 'true';
};

const readFontSize = () => {
  const stored = localStorage.getItem(CODE_EDITOR_STORAGE_KEYS.fontSize);
  return Number(stored ?? CODE_EDITOR_DEFAULTS.fontSize);
};

export const useCodeEditorSettings = () => {
  const [wordWrap, setWordWrap] = useState(readWordWrap);
  const [minimapEnabled, setMinimapEnabled] = useState(() => (
    readBoolean(CODE_EDITOR_STORAGE_KEYS.showMinimap, CODE_EDITOR_DEFAULTS.showMinimap)
  ));
  const [showLineNumbers, setShowLineNumbers] = useState(() => (
    readBoolean(CODE_EDITOR_STORAGE_KEYS.lineNumbers, CODE_EDITOR_DEFAULTS.lineNumbers)
  ));
  const [fontSize, setFontSize] = useState(readFontSize);

  // Keep legacy behavior where the editor writes wrap settings directly.
  useEffect(() => {
    localStorage.setItem(CODE_EDITOR_STORAGE_KEYS.wordWrap, String(wordWrap));
  }, [wordWrap]);

  useEffect(() => {
    const refreshFromStorage = () => {
      setWordWrap(readWordWrap());
      setMinimapEnabled(readBoolean(CODE_EDITOR_STORAGE_KEYS.showMinimap, CODE_EDITOR_DEFAULTS.showMinimap));
      setShowLineNumbers(readBoolean(CODE_EDITOR_STORAGE_KEYS.lineNumbers, CODE_EDITOR_DEFAULTS.lineNumbers));
      setFontSize(readFontSize());
    };

    window.addEventListener('storage', refreshFromStorage);
    window.addEventListener(CODE_EDITOR_SETTINGS_CHANGED_EVENT, refreshFromStorage);

    return () => {
      window.removeEventListener('storage', refreshFromStorage);
      window.removeEventListener(CODE_EDITOR_SETTINGS_CHANGED_EVENT, refreshFromStorage);
    };
  }, []);

  return {
    wordWrap,
    setWordWrap,
    minimapEnabled,
    setMinimapEnabled,
    showLineNumbers,
    setShowLineNumbers,
    fontSize,
    setFontSize,
  };
};
