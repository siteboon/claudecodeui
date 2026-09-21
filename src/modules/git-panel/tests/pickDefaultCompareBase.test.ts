import assert from 'node:assert/strict';

import { test } from 'vitest';

import { pickDefaultCompareBase } from '@/modules/git-panel/utils/gitPanelUtils';

test('prefers main, then master, then develop among local branches', () => {
  assert.equal(pickDefaultCompareBase(['feature', 'develop', 'main'], [], 'feature'), 'main');
  assert.equal(pickDefaultCompareBase(['feature', 'develop', 'master'], [], 'feature'), 'master');
  assert.equal(pickDefaultCompareBase(['feature', 'develop'], [], 'feature'), 'develop');
});

test('falls back to origin/main or origin/master when no local integration branch exists', () => {
  assert.equal(pickDefaultCompareBase(['feature'], ['origin/feature', 'origin/main'], 'feature'), 'origin/main');
  assert.equal(pickDefaultCompareBase(['feature'], ['origin/master'], 'feature'), 'origin/master');
});

test('otherwise picks the first branch that is not the current one', () => {
  assert.equal(pickDefaultCompareBase(['topic', 'other'], [], 'topic'), 'other');
  assert.equal(pickDefaultCompareBase(['topic'], ['origin/release'], 'topic'), 'origin/release');
});

test('uses the current branch when it is the only one, and nothing before branches load', () => {
  assert.equal(pickDefaultCompareBase(['main'], [], 'main'), 'main');
  assert.equal(pickDefaultCompareBase([], [], 'main'), '');
  assert.equal(pickDefaultCompareBase([], [], ''), '');
});

test('a local integration branch wins even when it is the current branch', () => {
  // Comparing a branch against itself is a valid (if uneventful) state; the
  // familiar default beats a surprising one.
  assert.equal(pickDefaultCompareBase(['main', 'feature'], ['origin/main'], 'main'), 'main');
});
