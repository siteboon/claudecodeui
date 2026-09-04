import assert from 'node:assert/strict';

import { beforeEach, test, vi } from 'vitest';

import { CODE_EDITOR_DEFAULTS, CODE_EDITOR_STORAGE_KEYS } from '@/shared/constants';
import {
  readCodeEditorSettings,
  writeCodeEditorSettings,
} from '@/shared/codeEditorSettings';
import {
  readUserPreference,
  resetUserPreferences,
  subscribeToUserPreferences,
  writeUserPreference,
} from '@/shared/userSettings';

/**
 * Regression guard for the settings/code-editor split ownership of the four
 * code-editor display settings.
 *
 * The settings module writes them and the code-editor module reads them. They
 * used to declare separate key maps and separate defaults ('14' vs '12'), and
 * the settings dialog wrote all four from a mount effect — so opening Settings
 * on any tab silently changed the editor font size for a user who had never
 * touched it.
 *
 * The four values now live in one server-backed `codeEditorSettings`
 * preference instead of four localStorage keys, so the guard is the same one
 * expressed against that blob: one writer, one reader, and a read that writes
 * nothing.
 */

vi.mock('@/shared/api', () => {
  const ok = async () => new Response('{}', {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

  return {
    api: {
      user: {
        preferences: async () => new Response(JSON.stringify({ preferences: {} }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
        savePreferences: ok,
        drafts: ok,
        saveDraft: ok,
        deleteDraft: ok,
      },
    },
  };
});

/** The single localStorage blob the preference store mirrors the server into. */
const MIRROR_STORAGE_KEY = 'user-preferences';

const mirroredPreferences = (): Record<string, unknown> => {
  const raw = localStorage.getItem(MIRROR_STORAGE_KEY);
  return raw === null ? {} : (JSON.parse(raw) as Record<string, unknown>);
};

beforeEach(() => {
  resetUserPreferences();
  localStorage.clear();
});

test('both modules resolve the same settings from one shared preference', () => {
  writeCodeEditorSettings({
    wordWrap: true,
    showMinimap: false,
    lineNumbers: false,
    fontSize: '18',
  });

  // The writer and the reader cannot drift onto different keys any more: there
  // is one key, and what the dialog wrote is what the editor reads back.
  assert.deepEqual(readUserPreference('codeEditorSettings', null), {
    wordWrap: true,
    showMinimap: false,
    lineNumbers: false,
    fontSize: '18',
  });
  assert.deepEqual(readCodeEditorSettings(), {
    wordWrap: true,
    showMinimap: false,
    lineNumbers: false,
    fontSize: '18',
  });

  for (const key of Object.values(CODE_EDITOR_STORAGE_KEYS)) {
    assert.equal(
      localStorage.getItem(key),
      null,
      `${key} is a legacy key and must no longer be written`,
    );
  }
});

test('the legacy per-setting keys stay declared for the one-time migration', () => {
  // The migration reader seeds `codeEditorSettings` from these exact names, so
  // dropping one silently resets that setting for anyone not yet migrated.
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

test('an explicit edit persists every setting and notifies the code-editor module', () => {
  // The editor is woken by the preference store, which notifies synchronously
  // in the writing tab too — that is what replaced the same-tab
  // `codeEditorSettingsChanged` event this used to count.
  let notified = 0;
  const unsubscribe = subscribeToUserPreferences(() => {
    notified += 1;
  });

  writeCodeEditorSettings({
    wordWrap: true,
    showMinimap: false,
    lineNumbers: false,
    fontSize: '18',
  });

  unsubscribe();

  // All four travel together, and they survive a reload: the mirror is what the
  // next page load reads before the server responds.
  assert.deepEqual(mirroredPreferences().codeEditorSettings, {
    wordWrap: true,
    showMinimap: false,
    lineNumbers: false,
    fontSize: '18',
  });
  assert.equal(notified, 1);
});

test('a font size the user already chose survives a settings read', () => {
  writeUserPreference('codeEditorSettings', { fontSize: '16' });

  assert.equal(readCodeEditorSettings().fontSize, '16');
});

test('reading writes nothing, so opening the dialog cannot materialize defaults', () => {
  // This is the invariant the whole split exists for: the settings dialog reads
  // on mount, and any write here lands on a user who never opened the editor —
  // and now also gets pushed to the server as their cross-device font size.
  readCodeEditorSettings();

  assert.equal(
    localStorage.getItem(MIRROR_STORAGE_KEY),
    null,
    'a read must not create the preference mirror',
  );
  assert.equal(mirroredPreferences().codeEditorSettings, undefined);
  assert.equal(readUserPreference('codeEditorSettings', null), null);
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
