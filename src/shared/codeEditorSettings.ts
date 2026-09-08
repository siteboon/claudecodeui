import { CODE_EDITOR_DEFAULTS } from '@/shared/constants';
import type { CodeEditorSettingsState } from '@/shared/types';
import { readUserPreference, writeUserPreference } from '@/shared/userSettings';

/**
 * The single reader and writer for the four code-editor display settings.
 *
 * The settings dialog writes them and the code editor reads them, and each
 * module used to decode the same four keys with its own helper — which had
 * already drifted on the fontSize default. One reader, one writer, one place to
 * change a key.
 *
 * They are stored as one blob in `auth.db` now, so the editor looks the same on
 * every device the user opens it from.
 */

type StoredCodeEditorSettings = Partial<Record<keyof CodeEditorSettingsState, unknown>>;

const readStoredBoolean = (stored: unknown, defaultValue: boolean): boolean => {
  if (typeof stored === 'boolean') {
    return stored;
  }
  // Values written before the move were the strings "true"/"false".
  if (typeof stored === 'string') {
    return stored !== 'false';
  }
  return defaultValue;
};

/**
 * Reading must never write: this runs when the settings dialog mounts, and a
 * write here would materialize defaults over settings the user never chose.
 *
 * `fontSize` stays a string. The settings dialog binds it to a select; the
 * editor turns it into a number.
 */
export const readCodeEditorSettings = (): CodeEditorSettingsState => {
  const stored = readUserPreference<StoredCodeEditorSettings>('codeEditorSettings', {});

  return {
    wordWrap: readStoredBoolean(stored.wordWrap, CODE_EDITOR_DEFAULTS.wordWrap),
    showMinimap: readStoredBoolean(stored.showMinimap, CODE_EDITOR_DEFAULTS.showMinimap),
    lineNumbers: readStoredBoolean(stored.lineNumbers, CODE_EDITOR_DEFAULTS.lineNumbers),
    fontSize: typeof stored.fontSize === 'string' ? stored.fontSize : CODE_EDITOR_DEFAULTS.fontSize,
  };
};

/**
 * Writes all four settings. The preference store notifies its subscribers
 * synchronously, including in the writing tab, so the editor re-reads without
 * a separate same-tab event. Called only from a user edit.
 */
export const writeCodeEditorSettings = (settings: CodeEditorSettingsState) => {
  writeUserPreference('codeEditorSettings', {
    wordWrap: settings.wordWrap,
    showMinimap: settings.showMinimap,
    lineNumbers: settings.lineNumbers,
    fontSize: settings.fontSize,
  });
};
