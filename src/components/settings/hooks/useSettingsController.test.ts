import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeMainTab } from './normalizeMainTab';

test('normalizes account to the account settings tab', () => {
  assert.equal(normalizeMainTab('account'), 'account');
});

test('preserves the voice settings tab', () => {
  assert.equal(normalizeMainTab('voice'), 'voice');
});

test('preserves legacy and unknown settings tab fallbacks', () => {
  assert.equal(normalizeMainTab('tools'), 'agents');
  assert.equal(normalizeMainTab('unknown'), 'agents');
});
