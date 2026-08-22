import assert from 'node:assert/strict';

import { beforeEach, test } from 'vitest';

import {
  isSelectedProviderStorageEvent,
  readSelectedProvider,
  SELECTED_PROVIDER_CHANGED_EVENT,
  writeSelectedProvider,
} from '@/shared/selectedProvider';

/**
 * The provider selection was read in six places by four different hand-rolled
 * readers, only one of which validated the stored value, and written from three
 * modules with no same-tab notification — so the git panel's reader was stale
 * for the whole session after a switch.
 */

beforeEach(() => {
  localStorage.clear();
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
  localStorage.setItem('selected-provider', 'not-a-provider');
  assert.equal(readSelectedProvider(), 'claude');
});

test('a write publishes a same-tab change, which the storage event does not', () => {
  let changes = 0;
  const onChange = () => {
    changes += 1;
  };
  window.addEventListener(SELECTED_PROVIDER_CHANGED_EVENT, onChange);

  writeSelectedProvider('cursor');

  window.removeEventListener(SELECTED_PROVIDER_CHANGED_EVENT, onChange);
  assert.equal(changes, 1);
});

test('a storage event for another key is ignored', () => {
  assert.equal(
    isSelectedProviderStorageEvent(new StorageEvent('storage', { key: 'theme' })),
    false,
  );
  assert.equal(
    isSelectedProviderStorageEvent(new StorageEvent('storage', { key: 'selected-provider' })),
    true,
  );
});
