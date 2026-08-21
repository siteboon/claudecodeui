import assert from 'node:assert/strict';

import { beforeEach, test } from 'vitest';

import { CODE_EDITOR_DEFAULTS, CODE_EDITOR_STORAGE_KEYS } from '@/shared/constants';
import {
  readCodeEditorSettings,
  writeCodeEditorSettings,
} from '@/shared/codeEditorSettings';

/**
 * Regression guard for the settings/code-editor split ownership of the four
 * `codeEditor*` localStorage keys.
 *
 * The settings module writes them and the code-editor module reads them. They
 * used to declare separate key maps and separate defaults ('14' vs '12'), and
 * the settings dialog wrote all four keys from a mount effect — so opening
 * Settings on any tab silently changed the editor font size for a user who had
 * never touched it.
 */

beforeEach(() => {
  localStorage.clear();
});

test('both modules resolve the same storage keys from one shared map', () => {
  assert.deepEqual(CODE_EDITOR_STORAGE_KEYS, {
    wordWrap: 'codeEditorWordWrap',
    showMinimap: 'codeEditorShowMinimap',
    lineNumbers: 'codeEditorLineNumbers',
    fontSize: 'codeEditorFontSize',
  });
});

test('the shared font-size default matches the editor default, not the old settings default', () => {
  // '14' was the settings-dialog default that overwrote the editor's '12'.
  assert.equal(CODE_EDITOR_DEFAULTS.fontSize, '12');
});

test('a fresh user gets the shared defaults', () => {
  const settings = readCodeEditorSettings();

  assert.equal(settings.fontSize, CODE_EDITOR_DEFAULTS.fontSize);
  assert.equal(settings.wordWrap, CODE_EDITOR_DEFAULTS.wordWrap);
  assert.equal(settings.showMinimap, CODE_EDITOR_DEFAULTS.showMinimap);
  assert.equal(settings.lineNumbers, CODE_EDITOR_DEFAULTS.lineNumbers);
});

test('an explicit edit writes every key and notifies the code-editor module', () => {
  let notified = 0;
  const onChanged = () => {
    notified += 1;
  };
  window.addEventListener('codeEditorSettingsChanged', onChanged);

  writeCodeEditorSettings({
    wordWrap: true,
    showMinimap: false,
    lineNumbers: false,
    fontSize: '18',
  });

  window.removeEventListener('codeEditorSettingsChanged', onChanged);

  assert.equal(localStorage.getItem(CODE_EDITOR_STORAGE_KEYS.wordWrap), 'true');
  assert.equal(localStorage.getItem(CODE_EDITOR_STORAGE_KEYS.showMinimap), 'false');
  assert.equal(localStorage.getItem(CODE_EDITOR_STORAGE_KEYS.lineNumbers), 'false');
  assert.equal(localStorage.getItem(CODE_EDITOR_STORAGE_KEYS.fontSize), '18');
  assert.equal(notified, 1);
});

test('a font size the user already chose survives a settings read', () => {
  localStorage.setItem(CODE_EDITOR_STORAGE_KEYS.fontSize, '16');

  assert.equal(readCodeEditorSettings().fontSize, '16');
});

test('reading writes nothing, so opening the dialog cannot materialize defaults', () => {
  // This is the invariant the whole split exists for: the settings dialog reads
  // on mount, and any write here lands on a user who never opened the editor.
  readCodeEditorSettings();

  for (const key of Object.values(CODE_EDITOR_STORAGE_KEYS)) {
    assert.equal(localStorage.getItem(key), null, `${key} must not be written by a read`);
  }
});

test('the editor and the dialog decode a stored value the same way', () => {
  // Two hand-rolled readers used to decode these keys; only one of them
  // honoured the default when the key was absent.
  writeCodeEditorSettings({
    wordWrap: true,
    showMinimap: false,
    lineNumbers: true,
    fontSize: '20',
  });

  assert.deepEqual(readCodeEditorSettings(), {
    wordWrap: true,
    showMinimap: false,
    lineNumbers: true,
    fontSize: '20',
  });
});
