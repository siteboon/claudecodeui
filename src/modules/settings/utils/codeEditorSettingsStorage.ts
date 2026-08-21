import {
  CODE_EDITOR_DEFAULTS,
  CODE_EDITOR_SETTINGS_CHANGED_EVENT,
  CODE_EDITOR_STORAGE_KEYS,
} from '@/shared/constants';
import type { CodeEditorSettingsState } from '@/shared/types';

/**
 * Reads the four code-editor display settings the settings dialog edits.
 *
 * Reading must never write: this runs when the dialog mounts, and a write here
 * would materialize defaults over settings the user never chose.
 */
export const readCodeEditorSettings = (): CodeEditorSettingsState => ({
  wordWrap: localStorage.getItem(CODE_EDITOR_STORAGE_KEYS.wordWrap) === 'true',
  showMinimap: localStorage.getItem(CODE_EDITOR_STORAGE_KEYS.showMinimap) !== 'false',
  lineNumbers: localStorage.getItem(CODE_EDITOR_STORAGE_KEYS.lineNumbers) !== 'false',
  fontSize: localStorage.getItem(CODE_EDITOR_STORAGE_KEYS.fontSize) ?? CODE_EDITOR_DEFAULTS.fontSize,
});

/**
 * Writes all four keys and tells the code-editor module to re-read them, since
 * the `storage` event does not fire in the tab that performed the write.
 * Called only from a user edit.
 */
export const writeCodeEditorSettings = (settings: CodeEditorSettingsState) => {
  localStorage.setItem(CODE_EDITOR_STORAGE_KEYS.wordWrap, String(settings.wordWrap));
  localStorage.setItem(CODE_EDITOR_STORAGE_KEYS.showMinimap, String(settings.showMinimap));
  localStorage.setItem(CODE_EDITOR_STORAGE_KEYS.lineNumbers, String(settings.lineNumbers));
  localStorage.setItem(CODE_EDITOR_STORAGE_KEYS.fontSize, settings.fontSize);
  window.dispatchEvent(new Event(CODE_EDITOR_SETTINGS_CHANGED_EVENT));
};
