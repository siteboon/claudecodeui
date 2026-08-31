import assert from 'node:assert/strict';
import test from 'node:test';

import { isUsableAddress } from '@/modules/chrome-tabs/chrome-tabs.service.js';

/**
 * What may be handed to Chrome.
 *
 * Every navigation costs the user a permission prompt in the extension, so a
 * fragment of the command itself must not reach it - and neither must a value
 * that only starts like an address.
 */

test('an address opens', () => {
  for (const url of [
    'example.com',
    'https://example.com',
    'http://example.com/a/b?c=1#d',
    'https://sub.example.co.uk',
    '127.0.0.1:3010',
    'http://localhost:3010',
  ]) {
    assert.equal(isUsableAddress(url), true, url);
  }
});

test('what only looks like one does not', () => {
  for (const url of [
    'bro',
    'browser',
    // Starts like an address and carries a sentence: a prefix test passes this.
    'example.com trailing text',
    // A scheme and no host at all.
    'http://',
    'https://',
    '://example.com',
    '',
    ' ',
  ]) {
    assert.equal(isUsableAddress(url), false, url);
  }
});

test('a scheme says what the user means, so a host without a dot is enough', () => {
  // "localhost" has no dot; typed bare it is indistinguishable from a stray
  // word, but "http://localhost:3010" is unambiguous.
  assert.equal(isUsableAddress('localhost:3010'), false);
  assert.equal(isUsableAddress('http://localhost:3010'), true);
});
