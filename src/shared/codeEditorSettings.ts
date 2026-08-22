import {
  CODE_EDITOR_DEFAULTS,
  CODE_EDITOR_SETTINGS_CHANGED_EVENT,
  CODE_EDITOR_STORAGE_KEYS,
} from '@/shared/constants';
import type { CodeEditorSettingsState } from '@/shared/types';

/**
 * The single reader and writer for the four code-editor display settings.
 *
 * The settings dialog writes them and the code editor reads them, and each
 * module used to decode the same four keys with its own helper — which had
 * already drifted on the fontSize default. One reader, one writer, one place to
 * change a key.
 */

const readStoredBoolean = (storageKey: string, defaultValue: boolean): boolean => {
  const stored = localStorage.getItem(storageKey);
  return stored === null ? defaultValue : stored !== 'false';
};

/**
 * Reading must never write: this runs when the settings dialog mounts, and a
 * write here would materialize defaults over settings the user never chose.
 *
 * `fontSize` stays the stored string. The settings dialog binds it to a select;
 * the editor turns it into a number.
 */
export const readCodeEditorSettings = (): CodeEditorSettingsState => ({
  wordWrap: readStoredBoolean(CODE_EDITOR_STORAGE_KEYS.wordWrap, CODE_EDITOR_DEFAULTS.wordWrap),
  showMinimap: readStoredBoolean(CODE_EDITOR_STORAGE_KEYS.showMinimap, CODE_EDITOR_DEFAULTS.showMinimap),
  lineNumbers: readStoredBoolean(CODE_EDITOR_STORAGE_KEYS.lineNumbers, CODE_EDITOR_DEFAULTS.lineNumbers),
  fontSize: localStorage.getItem(CODE_EDITOR_STORAGE_KEYS.fontSize) ?? CODE_EDITOR_DEFAULTS.fontSize,
});

/**
 * Writes all four keys and tells the code editor to re-read them, since the
 * `storage` event does not fire in the tab that performed the write.
 * Called only from a user edit.
 */
export const writeCodeEditorSettings = (settings: CodeEditorSettingsState) => {
  localStorage.setItem(CODE_EDITOR_STORAGE_KEYS.wordWrap, String(settings.wordWrap));
  localStorage.setItem(CODE_EDITOR_STORAGE_KEYS.showMinimap, String(settings.showMinimap));
  localStorage.setItem(CODE_EDITOR_STORAGE_KEYS.lineNumbers, String(settings.lineNumbers));
  localStorage.setItem(CODE_EDITOR_STORAGE_KEYS.fontSize, settings.fontSize);
  window.dispatchEvent(new Event(CODE_EDITOR_SETTINGS_CHANGED_EVENT));
};
