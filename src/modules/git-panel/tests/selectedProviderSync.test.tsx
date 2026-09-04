import assert from 'node:assert/strict';

import { act, renderHook } from '@testing-library/react';
import { beforeEach, test } from 'vitest';

import { useSelectedProvider } from '@/modules/git-panel/hooks/useSelectedProvider';
import { writeSelectedProvider } from '@/shared/selectedProvider';
import {
  resetUserPreferences,
  subscribeToUserPreferences,
  writeUserPreference,
} from '@/shared/userSettings';

/**
 * The receiving half of the provider-selection contract.
 *
 * The git panel used to listen only for the cross-tab `storage` event, which
 * does not fire in the tab that performed the write — so switching provider in
 * the composer left the panel attributing generated commit messages to the old
 * provider for the rest of the session. selectedProvider.test.ts covers the
 * emitting half; this covers the half that had the bug.
 */

beforeEach(() => {
  localStorage.clear();
  // The preference store is a module-level singleton, so its in-memory copy
  // outlives localStorage.clear() and would leak one test's writes into the next.
  resetUserPreferences();
});

test('an unset provider starts at the shared default', () => {
  const { result } = renderHook(() => useSelectedProvider());

  assert.equal(result.current, 'claude');
});

test('a provider stored before mount is picked up', () => {
  writeSelectedProvider('codex');

  const { result } = renderHook(() => useSelectedProvider());

  assert.equal(result.current, 'codex');
});

test('a switch made in this tab reaches the panel', () => {
  const { result } = renderHook(() => useSelectedProvider());

  act(() => {
    writeSelectedProvider('cursor');
  });

  assert.equal(result.current, 'cursor');
});

test('a switch made elsewhere reaches the panel', () => {
  // Previously a cross-tab `storage` event. The selection lives in auth.db now,
  // so the same path also carries a switch made on another device.
  const { result } = renderHook(() => useSelectedProvider());

  act(() => {
    writeUserPreference('selectedProvider', 'opencode');
  });

  assert.equal(result.current, 'opencode');
});

test('an unrelated preference change does not change the reported provider', () => {
  writeSelectedProvider('codex');
  const { result } = renderHook(() => useSelectedProvider());

  act(() => {
    writeUserPreference('theme', 'dark');
  });

  assert.equal(result.current, 'codex');
});

test('the panel releases its subscription when it unmounts', () => {
  // Asserted by counting the store's live subscribers rather than by writing a
  // preference after unmount: React drops a setState on an unmounted component
  // silently, so a leak is invisible from the outside and the test would pass
  // whether or not the cleanup ran.
  let liveSubscribers = 0;
  const countLive = () => {
    liveSubscribers += 1;
  };
  const stopCounting = subscribeToUserPreferences(countLive);

  const { unmount } = renderHook(() => useSelectedProvider());
  writeUserPreference('selectedProvider', 'cursor');
  const withPanelMounted = liveSubscribers;

  unmount();
  liveSubscribers = 0;
  writeUserPreference('selectedProvider', 'opencode');

  stopCounting();
  assert.equal(withPanelMounted, 1, 'the counter itself must be notified once per write');
  assert.equal(liveSubscribers, 1, 'only the counter should remain; the panel leaked');
});
