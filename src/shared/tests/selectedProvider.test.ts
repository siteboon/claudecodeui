import assert from 'node:assert/strict';

import { beforeEach, test } from 'vitest';

import { readSelectedProvider, writeSelectedProvider } from '@/shared/selectedProvider';
import { subscribeToUserPreferences, writeUserPreference, resetUserPreferences } from '@/shared/userSettings';

/**
 * The provider selection was read in six places by four different hand-rolled
 * readers, only one of which validated the stored value, and written from three
 * modules with no same-tab notification — so the git panel's reader was stale
 * for the whole session after a switch.
 */

beforeEach(() => {
  localStorage.clear();
  // The preference store is a module-level singleton, so its in-memory copy
  // outlives localStorage.clear() and would leak one test's writes into the next.
  resetUserPreferences();
});

test('an unset provider falls back to claude', () => {
  assert.equal(readSelectedProvider(), 'claude');
});

test('a stored provider is read back', () => {
  writeSelectedProvider('codex');
  assert.equal(readSelectedProvider(), 'codex');
});

test('a value that is not a known provider falls back instead of being trusted', () => {
  // Only one of the previous readers validated; the rest returned this verbatim.
  writeUserPreference('selectedProvider', 'not-a-provider');
  assert.equal(readSelectedProvider(), 'claude');
});

test('a write publishes a same-tab change, which the storage event does not', () => {
  // The whole reason this module exists: the git panel listened only for the
  // cross-tab `storage` event and so never saw a switch made in its own tab.
  // The preference store notifies its subscribers synchronously, in the writing
  // tab too, which is what replaced the hand-rolled event.
  let changes = 0;
  const unsubscribe = subscribeToUserPreferences(() => {
    changes += 1;
  });

  writeSelectedProvider('cursor');

  unsubscribe();
  assert.equal(changes, 1);
});

test('a change to an unrelated preference does not read as a provider switch', () => {
  // The cross-tab `storage` listener this replaced had to filter by key, or a
  // theme toggle in another tab looked like a provider switch. The preference
  // store notifies on any change, so the guarantee moved to the reader: it must
  // still report the provider that is actually stored.
  writeSelectedProvider('codex');

  let observed: string | null = null;
  const unsubscribe = subscribeToUserPreferences(() => {
    observed = readSelectedProvider();
  });
  writeUserPreference('theme', 'dark');
  unsubscribe();

  assert.equal(observed, 'codex');
});
