import { useEffect, useState } from 'react';
import {
  CODE_EDITOR_DEFAULTS,
  CODE_EDITOR_SETTINGS_CHANGED_EVENT,
  CODE_EDITOR_STORAGE_KEYS,
} from '../constants/settings';

const readTheme = () => {
  const savedTheme = localStorage.getItem(CODE_EDITOR_STORAGE_KEYS.theme);
  if (!savedTheme) {
    return CODE_EDITOR_DEFAULTS.isDarkMode;
  }

  return savedTheme === 'dark';
};

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
  const [isDarkMode, setIsDarkMode] = useState(readTheme);
  const [wordWrap, setWordWrap] = useState(readWordWrap);
  const [minimapEnabled, setMinimapEnabled] = useState(() => (
    readBoolean(CODE_EDITOR_STORAGE_KEYS.showMinimap, CODE_EDITOR_DEFAULTS.minimapEnabled)
  ));
  const [showLineNumbers, setShowLineNumbers] = useState(() => (
    readBoolean(CODE_EDITOR_STORAGE_KEYS.lineNumbers, CODE_EDITOR_DEFAULTS.showLineNumbers)
  ));
  const [fontSize, setFontSize] = useState(readFontSize);

  // Keep legacy behavior where the editor writes theme and wrap settings directly.
  useEffect(() => {
    localStorage.setItem(CODE_EDITOR_STORAGE_KEYS.theme, isDarkMode ? 'dark' : 'light');
  }, [isDarkMode]);

  useEffect(() => {
    localStorage.setItem(CODE_EDITOR_STORAGE_KEYS.wordWrap, String(wordWrap));
  }, [wordWrap]);

  useEffect(() => {
    const refreshFromStorage = () => {
      setIsDarkMode(readTheme());
      setWordWrap(readWordWrap());
      setMinimapEnabled(readBoolean(CODE_EDITOR_STORAGE_KEYS.showMinimap, CODE_EDITOR_DEFAULTS.minimapEnabled));
      setShowLineNumbers(readBoolean(CODE_EDITOR_STORAGE_KEYS.lineNumbers, CODE_EDITOR_DEFAULTS.showLineNumbers));
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
    isDarkMode,
    setIsDarkMode,
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
