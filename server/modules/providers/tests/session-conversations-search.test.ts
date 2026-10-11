import assert from 'node:assert/strict';
import test from 'node:test';

import { createWordMatcher, toSearchWords } from '@/modules/providers/services/session-conversations-search.service.js';

/**
 * A multi-word query used to need the exact phrase, so "odm images" missed a
 * transcript that only ever said "ODM image". These pin the relaxed matcher:
 * every word, any order, matched at the start of a token.
 */

const words = toSearchWords;

test('every word must appear, in any order', () => {
  const matcher = createWordMatcher(words('odm images'));
  assert.equal(matcher.matchesQuery('the ODM image is ready'), true);
  assert.equal(matcher.matchesQuery('images for the odm drop'), true);
  assert.equal(matcher.matchesQuery('the odm drop'), false);
});

test('a trailing plural s is optional, short words are left alone', () => {
  assert.deepEqual(words('ODM Images boss As'), ['odm', 'image', 'boss', 'as']);
});

test('a word matches at the start of a token only', () => {
  const matcher = createWordMatcher(words('odm'));
  assert.equal(matcher.matchesQuery('an odm-only build'), true);
  assert.equal(matcher.matchesQuery('random'), false);
});

test('the snippet highlights each word when there is no phrase hit', () => {
  const matcher = createWordMatcher(words('odm images'));
  const { snippet, highlights } = matcher.buildSnippet('images for the odm drop');
  assert.equal(snippet, 'images for the odm drop');
  assert.deepEqual(highlights, [
    { start: 0, end: 6 },
    { start: 15, end: 18 },
  ]);
});

test('a phrase hit is highlighted as one range', () => {
  const matcher = createWordMatcher(words('odm image'));
  const { highlights } = matcher.buildSnippet('the ODM image is ready');
  assert.deepEqual(highlights, [{ start: 4, end: 13 }]);
});
