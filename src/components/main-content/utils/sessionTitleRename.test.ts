import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeSessionTitleRename } from './sessionTitleRename';

test('rejects empty session title renames', () => {
  assert.equal(normalizeSessionTitleRename('Current', '   '), null);
});

test('rejects unchanged session title renames', () => {
  assert.equal(normalizeSessionTitleRename('Current', ' Current '), null);
});

test('returns trimmed changed session title', () => {
  assert.equal(normalizeSessionTitleRename('Current', ' New title '), 'New title');
});
