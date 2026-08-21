import { useEffect, useState } from 'react';

import { readCodeEditorSettings } from '@/shared/codeEditorSettings';
import { CODE_EDITOR_SETTINGS_CHANGED_EVENT, CODE_EDITOR_STORAGE_KEYS } from '@/shared/constants';

/** CodeEditorSurface's fontSize prop is a number; the settings dialog edits a string. */
const readEditorSettings = () => {
  const stored = readCodeEditorSettings();
  return { ...stored, fontSize: Number(stored.fontSize) };
};

export const useCodeEditorSettings = () => {
  // Mirrors the four persisted display settings so the editor re-renders when
  // the settings dialog rewrites them, in this tab or another one.
  const [settings, setSettings] = useState(readEditorSettings);

  // Keep legacy behavior where the editor writes wrap settings directly.
  useEffect(() => {
    localStorage.setItem(CODE_EDITOR_STORAGE_KEYS.wordWrap, String(settings.wordWrap));
  }, [settings.wordWrap]);

  useEffect(() => {
    const refreshFromStorage = () => {
      setSettings(readEditorSettings());
    };

    window.addEventListener('storage', refreshFromStorage);
    window.addEventListener(CODE_EDITOR_SETTINGS_CHANGED_EVENT, refreshFromStorage);

    return () => {
      window.removeEventListener('storage', refreshFromStorage);
      window.removeEventListener(CODE_EDITOR_SETTINGS_CHANGED_EVENT, refreshFromStorage);
    };
  }, []);

  return {
    wordWrap: settings.wordWrap,
    minimapEnabled: settings.showMinimap,
    showLineNumbers: settings.lineNumbers,
    fontSize: settings.fontSize,
  };
};
