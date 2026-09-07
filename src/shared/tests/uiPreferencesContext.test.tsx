import assert from 'node:assert/strict';

import { act, render, renderHook } from '@testing-library/react';
import React from 'react';
import { beforeEach, test } from 'vitest';

import {
  UiPreferencesProvider,
  useSetUiPreference,
  useUiPreferences,
} from '@/shared/context/UiPreferencesContext';
import { readUserPreference, writeUserPreference, resetUserPreferences } from '@/shared/userSettings';

/**
 * The point of the provider is that there is exactly one copy of the state.
 * Previously each call site held its own reducer and they reconciled through a
 * `ui-preferences:sync` CustomEvent, so a single toggle wrote storage once
 * per consumer and every consumer re-rendered regardless of which key changed.
 */

const wrapper = ({ children }: { children: React.ReactNode }) =>
  React.createElement(UiPreferencesProvider, null, children);

beforeEach(() => {
  localStorage.clear();
  // The preference store is a module-level singleton, so its in-memory copy
  // outlives localStorage.clear() and would leak one test's writes into the next.
  resetUserPreferences();
});

test('a toggle in one consumer is visible to another', () => {
  const { result } = renderHook(
    () => ({ preferences: useUiPreferences(), setPreference: useSetUiPreference() }),
    { wrapper },
  );

  act(() => {
    result.current.setPreference('showThinking', false);
  });

  assert.equal(result.current.preferences.showThinking, false);
});

test('a toggle persists to the single stored blob', () => {
  const { result } = renderHook(() => useSetUiPreference(), { wrapper });

  act(() => {
    result.current('voiceEnabled', true);
  });

  const stored = readUserPreference<Record<string, unknown>>('uiPreferences', {});
  assert.equal(stored.voiceEnabled, true);
});

test('a change made elsewhere is picked up', () => {
  // Previously this arrived as a cross-tab `storage` event. It now arrives from
  // the preference store, which also covers a change made on another device.
  const { result } = renderHook(() => useUiPreferences(), { wrapper });
  assert.equal(result.current.showThinking, true);

  act(() => {
    writeUserPreference('uiPreferences', { showThinking: false });
  });

  assert.equal(result.current.showThinking, false);
});

test('mounting does not write the defaults over preferences not yet fetched', () => {
  // The persist effect is keyed on the state, so without a guard it fires on
  // mount — pushing this device's defaults to the server before the user's real
  // preferences had been hydrated.
  renderHook(() => useUiPreferences(), { wrapper });

  assert.equal(
    readUserPreference<unknown>('uiPreferences', null),
    null,
    'mounting must not persist anything',
  );
});

test('a value arriving from the store is not echoed straight back to it', () => {
  const { result } = renderHook(() => useUiPreferences(), { wrapper });

  act(() => {
    writeUserPreference('uiPreferences', { showThinking: false, voiceEnabled: true });
  });

  assert.equal(result.current.showThinking, false);
  // The reducer returns a fresh object for an incoming change, so a guard that
  // compared by identity would not catch it and would rewrite the blob with all
  // five keys spelled out. The tell is that the stored value is untouched.
  assert.deepEqual(
    readUserPreference<Record<string, unknown>>('uiPreferences', {}),
    { showThinking: false, voiceEnabled: true },
  );
});

test('the setter identity survives a toggle, so a write-only consumer can memo on it', () => {
  const setters: Array<(key: 'showThinking', value: boolean) => void> = [];
  const { result } = renderHook(
    () => {
      const setPreference = useSetUiPreference();
      setters.push(setPreference);
      return { preferences: useUiPreferences(), setPreference };
    },
    { wrapper },
  );

  act(() => {
    result.current.setPreference('showThinking', false);
  });

  assert.ok(setters.length > 1, 'expected a re-render to have happened');
  assert.equal(setters[0], setters[setters.length - 1], 'the setter identity must not change');
});

test('there is one owner: a write from one consumer commits once for the reader', () => {
  const readerCommits: boolean[] = [];

  function Reader() {
    const { showThinking } = useUiPreferences();
    // Recorded from an effect: mutating during render is a side effect.
    React.useEffect(() => {
      readerCommits.push(showThinking);
    });
    return React.createElement('span', { 'data-testid': 'reader' }, String(showThinking));
  }

  const toggleRef: { current: (() => void) | null } = { current: null };
  function Writer() {
    const setPreference = useSetUiPreference();
    React.useEffect(() => {
      toggleRef.current = () => setPreference('showThinking', false);
    }, [setPreference]);
    return null;
  }

  const { getByTestId } = render(
    React.createElement(UiPreferencesProvider, null,
      React.createElement(Reader),
      React.createElement(Writer)),
  );

  assert.equal(getByTestId('reader').textContent, 'true');
  const commitsBefore = readerCommits.length;

  act(() => {
    toggleRef.current?.();
  });

  assert.equal(getByTestId('reader').textContent, 'false');
  assert.equal(
    readerCommits.length,
    commitsBefore + 1,
    'one commit, not one per consumer copy reconciling through an event',
  );
});

test('no same-tab sync event is needed or emitted', () => {
  let syncEvents = 0;
  const countSync = () => {
    syncEvents += 1;
  };
  window.addEventListener('ui-preferences:sync', countSync);

  const { result } = renderHook(() => useSetUiPreference(), { wrapper });
  act(() => {
    result.current('showThinking', false);
  });

  window.removeEventListener('ui-preferences:sync', countSync);
  assert.equal(syncEvents, 0);
});
