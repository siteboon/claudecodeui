import { useEffect, useState } from 'react';

import { readCodeEditorSettings } from '@/shared/codeEditorSettings';
import { subscribeToUserPreferences } from '@/shared/userSettings';

/** CodeEditorSurface's fontSize prop is a number; the settings dialog edits a string. */
const readEditorSettings = () => {
  const stored = readCodeEditorSettings();
  return { ...stored, fontSize: Number(stored.fontSize) };
};

export const useCodeEditorSettings = () => {
  // Mirrors the four persisted display settings so the editor re-renders when
  // the settings dialog rewrites them, in this tab or on another device.
  const [settings, setSettings] = useState(readEditorSettings);

  // One subscription covers both a write from the settings dialog in this tab
  // and one arriving with the hydrated preferences, because the store notifies
  // synchronously in the writing tab too.
  useEffect(() => subscribeToUserPreferences(() => {
    setSettings(readEditorSettings());
  }), []);

  return {
    wordWrap: settings.wordWrap,
    minimapEnabled: settings.showMinimap,
    showLineNumbers: settings.lineNumbers,
    fontSize: settings.fontSize,
  };
};
