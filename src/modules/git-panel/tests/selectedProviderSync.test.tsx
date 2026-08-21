import assert from 'node:assert/strict';

import { act, renderHook } from '@testing-library/react';
import { beforeEach, test, vi } from 'vitest';

import { useSelectedProvider } from '@/modules/git-panel/hooks/useSelectedProvider';
import { writeSelectedProvider } from '@/shared/selectedProvider';

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

test('a switch made in another tab reaches the panel', () => {
  const { result } = renderHook(() => useSelectedProvider());

  act(() => {
    localStorage.setItem('selected-provider', 'opencode');
    window.dispatchEvent(new StorageEvent('storage', {
      key: 'selected-provider',
      newValue: 'opencode',
    }));
  });

  assert.equal(result.current, 'opencode');
});

test('an unrelated storage event does not trigger a re-read', () => {
  writeSelectedProvider('codex');
  const { result } = renderHook(() => useSelectedProvider());

  act(() => {
    // A different key changing must not make the panel re-read; the guard is
    // what keeps every localStorage write in the app from waking it.
    localStorage.setItem('selected-provider', 'cursor');
    window.dispatchEvent(new StorageEvent('storage', { key: 'theme', newValue: 'dark' }));
  });

  assert.equal(result.current, 'codex');
});

test('the panel unsubscribes both listeners when it unmounts', () => {
  // Asserted on the (type, handler) pairs rather than by dispatching after
  // unmount: React drops a setState on an unmounted component silently, so a
  // leaked listener is invisible from the outside and the test would pass
  // whether or not the cleanup ran.
  const OUR_EVENTS = new Set(['storage', 'selected-provider:changed']);
  const added = vi.spyOn(window, 'addEventListener');
  const removed = vi.spyOn(window, 'removeEventListener');

  const { unmount } = renderHook(() => useSelectedProvider());
  const subscribed = added.mock.calls.filter(([type]) => OUR_EVENTS.has(String(type)));
  assert.equal(subscribed.length, 2, 'expected the same-tab and cross-tab listeners');

  unmount();

  for (const [type, handler] of subscribed) {
    assert.ok(
      removed.mock.calls.some(([t, h]) => t === type && h === handler),
      `${String(type)} listener was never removed`,
    );
  }
});
