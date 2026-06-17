import assert from 'node:assert/strict';
import test from 'node:test';

import { sliceTailPage } from '@/shared/utils.js';

const ITEMS = ['a', 'b', 'c', 'd', 'e'];

test('offset 0 returns the most recent page', () => {
  const { page, hasMore } = sliceTailPage(ITEMS, 2, 0);
  assert.deepEqual(page, ['d', 'e']);
  assert.equal(hasMore, true);
});

test('increasing offsets walk backwards in time', () => {
  const { page, hasMore } = sliceTailPage(ITEMS, 2, 2);
  assert.deepEqual(page, ['b', 'c']);
  assert.equal(hasMore, true);
});

test('the oldest page reports hasMore false', () => {
  const { page, hasMore } = sliceTailPage(ITEMS, 2, 4);
  assert.deepEqual(page, ['a']);
  assert.equal(hasMore, false);
});

test('null limit returns everything', () => {
  const { page, hasMore } = sliceTailPage(ITEMS, null, 0);
  assert.deepEqual(page, ITEMS);
  assert.equal(hasMore, false);
});

test('offsets past the start return an empty page', () => {
  const { page, hasMore } = sliceTailPage(ITEMS, 3, 10);
  assert.deepEqual(page, []);
  assert.equal(hasMore, false);
});

test('zero limit returns an empty page but keeps hasMore accurate', () => {
  const { page, hasMore } = sliceTailPage(ITEMS, 0, 0);
  assert.deepEqual(page, []);
  assert.equal(hasMore, true);
});
