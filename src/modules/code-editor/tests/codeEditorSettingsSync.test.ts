import assert from 'node:assert/strict';

import { act, renderHook } from '@testing-library/react';
import { beforeEach, test, vi } from 'vitest';

import { useCodeEditorSettings } from '@/modules/code-editor/hooks/useCodeEditorSettings';
import type * as UserSettings from '@/shared/userSettings';
import { writeCodeEditorSettings } from '@/shared/codeEditorSettings';
import {
  hydrateUserPreferences,
  resetUserPreferences,
  writeUserPreference,
} from '@/shared/userSettings';

/**
 * The receiving half of the code-editor settings contract.
 *
 * Both directions now arrive the same way. A write from the settings dialog in
 * this tab and a change made on another device (which arrives with the hydrated
 * preferences) both reach the editor through subscribeToUserPreferences,
 * because the store notifies its subscribers synchronously in the writing tab
 * too. That replaced both the `storage` event the four localStorage keys used
 * to fire and the same-tab `codeEditorSettingsChanged` event that covered for
 * it — the editor keeping an old font until a reload is what either missing
 * path looks like.
 *
 * The editor also decodes fontSize as a number while the dialog stores a
 * string; both used to run their own copy of the decoding.
 */

const { serverPreferences, subscriptions } = vi.hoisted(() => ({
  serverPreferences: { current: {} as Record<string, unknown> },
  subscriptions: [] as Array<{ released: boolean }>,
}));

vi.mock('@/shared/api', () => {
  const ok = async () => new Response('{}', {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

  return {
    api: {
      user: {
        preferences: async () => new Response(
          JSON.stringify({ preferences: serverPreferences.current }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
        savePreferences: ok,
        drafts: ok,
        saveDraft: ok,
        deleteDraft: ok,
      },
    },
  };
});

type UserSettingsModule = typeof UserSettings;

// The real store, with every subscription tagged so the unmount test can see
// whether the hook released it. A leaked store subscription is invisible from
// the outside for the same reason a leaked DOM listener is: React drops the
// setState of an unmounted component silently.
vi.mock('@/shared/userSettings', async (importOriginal) => {
  const actual = await importOriginal<UserSettingsModule>();

  return {
    ...actual,
    subscribeToUserPreferences: (listener: () => void) => {
      const subscription = { released: false };
      subscriptions.push(subscription);
      const unsubscribe = actual.subscribeToUserPreferences(listener);

      return () => {
        subscription.released = true;
        unsubscribe();
      };
    },
  };
});

beforeEach(() => {
  resetUserPreferences();
  localStorage.clear();
  serverPreferences.current = {};
  subscriptions.length = 0;
});

test('a settings edit in the same tab reaches the open editor', () => {
  const { result } = renderHook(() => useCodeEditorSettings());
  const before = result.current.fontSize;

  act(() => {
    writeCodeEditorSettings({
      wordWrap: true,
      showMinimap: false,
      lineNumbers: false,
      fontSize: '20',
    });
  });

  assert.notEqual(before, 20);
  assert.equal(result.current.fontSize, 20);
  assert.equal(result.current.wordWrap, true);
  assert.equal(result.current.minimapEnabled, false);
  assert.equal(result.current.showLineNumbers, false);
});

test('a settings edit made on another device reaches the editor when preferences hydrate', async () => {
  const { result } = renderHook(() => useCodeEditorSettings());
  const before = result.current.fontSize;

  // No CODE_EDITOR_SETTINGS_CHANGED_EVENT here: nothing in this tab wrote the
  // value, so only the store subscription can deliver it.
  serverPreferences.current = {
    codeEditorSettings: {
      wordWrap: true,
      showMinimap: true,
      lineNumbers: true,
      fontSize: '18',
    },
  };

  await act(async () => {
    await hydrateUserPreferences();
  });

  assert.notEqual(before, 18);
  assert.equal(result.current.fontSize, 18);
  assert.equal(result.current.wordWrap, true);
});

test('the editor reads fontSize as a number, not the stored string', () => {
  writeUserPreference('codeEditorSettings', { fontSize: '16' });

  const { result } = renderHook(() => useCodeEditorSettings());

  assert.equal(result.current.fontSize, 16);
});

test('an unset minimap keeps the shared default rather than reading as off', () => {
  // `localStorage.getItem(...) !== 'false'` and "default when absent" agree
  // here only because the default is true; the editor used to decode wordWrap
  // with the opposite rule.
  const { result } = renderHook(() => useCodeEditorSettings());

  assert.equal(result.current.minimapEnabled, true);
  assert.equal(result.current.showLineNumbers, true);
  assert.equal(result.current.wordWrap, false);
});

test('the editor releases its subscription when it unmounts', () => {
  // Asserted on the store subscription rather than by writing a preference
  // after unmount: React drops a setState on an unmounted component silently,
  // so a leak is invisible from the outside and the test would pass whether or
  // not the cleanup ran.
  const { unmount } = renderHook(() => useCodeEditorSettings());

  assert.equal(subscriptions.length, 1, 'expected the preference-store subscription');
  assert.equal(subscriptions[0].released, false);

  unmount();

  assert.equal(subscriptions[0].released, true, 'the preference-store subscription leaked');
});
