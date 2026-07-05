import assert from 'node:assert/strict';
import test from 'node:test';

import { getEnabledProviders } from './enabledProviders';

test('getEnabledProviders returns all providers when unset', () => {
  assert.deepEqual(getEnabledProviders(''), ['claude', 'cursor', 'codex', 'gemini', 'opencode']);
});

test('getEnabledProviders filters and deduplicates configured providers', () => {
  assert.deepEqual(getEnabledProviders(' codex, claude,unknown,codex '), ['codex', 'claude']);
});

test('getEnabledProviders falls back to all providers when config has no valid provider', () => {
  assert.deepEqual(getEnabledProviders('unknown'), ['claude', 'cursor', 'codex', 'gemini', 'opencode']);
});
