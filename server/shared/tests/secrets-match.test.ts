import assert from 'node:assert/strict';
import test from 'node:test';

import { secretsMatch } from '@/shared/utils.js';

test('matches only the exact secret', () => {
  assert.equal(secretsMatch('s3cret-key', 's3cret-key'), true);
  assert.equal(secretsMatch('s3cret-kez', 's3cret-key'), false);
});

test('rejects a prefix or extension of the secret despite the length difference', () => {
  assert.equal(secretsMatch('s3cret', 's3cret-key'), false);
  assert.equal(secretsMatch('s3cret-key-extra', 's3cret-key'), false);
  assert.equal(secretsMatch('', 's3cret-key'), false);
});

test('rejects a missing or non-string credential', () => {
  assert.equal(secretsMatch(undefined, 's3cret-key'), false);
  assert.equal(secretsMatch(['s3cret-key'], 's3cret-key'), false);
});
