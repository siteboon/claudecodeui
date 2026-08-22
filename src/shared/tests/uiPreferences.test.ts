import assert from 'node:assert/strict';

import { beforeEach, test } from 'vitest';

import {
  readInitialUiPreferences,
  uiPreferencesReducer,
  UI_PREFERENCES_STORAGE_KEY,
} from '@/shared/uiPreferences';
import type { UiPreferences } from '@/shared/uiPreferences';

/**
 * These preferences were previously held by four independent useReducer
 * instances that reconciled through a CustomEvent. Consolidating them onto one
 * owner has to preserve the stored shape, the legacy per-key migration and the
 * string/boolean coercion, or users lose settings on upgrade.
 */

beforeEach(() => {
  localStorage.clear();
});

const baseline = (): UiPreferences => readInitialUiPreferences();

test('a fresh install gets the documented defaults', () => {
  assert.deepEqual(readInitialUiPreferences(), {
    showRawParameters: false,
    showThinking: true,
    sendByCtrlEnter: false,
    sidebarVisible: true,
    voiceEnabled: false,
  });
});

test('the unified blob is read back', () => {
  localStorage.setItem(
    UI_PREFERENCES_STORAGE_KEY,
    JSON.stringify({ showThinking: false, voiceEnabled: true }),
  );

  const preferences = readInitialUiPreferences();
  assert.equal(preferences.showThinking, false);
  assert.equal(preferences.voiceEnabled, true);
  assert.equal(preferences.sidebarVisible, true, 'unlisted keys keep their default');
});

test('values stored as strings are coerced, as older versions wrote them', () => {
  localStorage.setItem(
    UI_PREFERENCES_STORAGE_KEY,
    JSON.stringify({ showThinking: 'false', voiceEnabled: 'true' }),
  );

  const preferences = readInitialUiPreferences();
  assert.equal(preferences.showThinking, false);
  assert.equal(preferences.voiceEnabled, true);
});

test('settings from before the unified blob still migrate', () => {
  localStorage.setItem('showThinking', JSON.stringify(false));
  localStorage.setItem('sidebarVisible', JSON.stringify(false));

  const preferences = readInitialUiPreferences();
  assert.equal(preferences.showThinking, false);
  assert.equal(preferences.sidebarVisible, false);
});

test('the unified blob wins over the legacy keys', () => {
  localStorage.setItem('showThinking', JSON.stringify(false));
  localStorage.setItem(UI_PREFERENCES_STORAGE_KEY, JSON.stringify({ showThinking: true }));

  assert.equal(readInitialUiPreferences().showThinking, true);
});

test('a corrupt blob falls back instead of throwing', () => {
  localStorage.setItem(UI_PREFERENCES_STORAGE_KEY, '{not json');

  assert.equal(readInitialUiPreferences().showThinking, true);
});

test('setting a preference changes only that key', () => {
  const state = baseline();
  const next = uiPreferencesReducer(state, { type: 'set', key: 'showThinking', value: false });

  assert.equal(next.showThinking, false);
  assert.equal(next.sidebarVisible, state.sidebarVisible);
});

test('setting a preference to its current value keeps the same object', () => {
  const state = baseline();
  const next = uiPreferencesReducer(state, { type: 'set', key: 'showThinking', value: true });

  assert.equal(next, state, 'a no-op must not wake consumers');
});

test('an unknown key is ignored', () => {
  const state = baseline();
  const next = uiPreferencesReducer(state, {
    type: 'set',
    key: 'notAPreference' as never,
    value: true,
  });

  assert.equal(next, state);
});

test('a cross-tab update applies every changed key at once', () => {
  const state = baseline();
  const next = uiPreferencesReducer(state, {
    type: 'set_many',
    value: { showThinking: false, voiceEnabled: true },
  });

  assert.equal(next.showThinking, false);
  assert.equal(next.voiceEnabled, true);
});

test('a cross-tab update with nothing new keeps the same object', () => {
  const state = baseline();
  const next = uiPreferencesReducer(state, {
    type: 'set_many',
    value: { showThinking: state.showThinking },
  });

  assert.equal(next, state);
});
