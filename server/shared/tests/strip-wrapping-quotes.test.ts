import assert from 'node:assert/strict';
import test from 'node:test';

import { stripWrappingQuotes } from '@/shared/utils.js';

// CLAUDE_CLI_PATH relied on these exact rules before the helper was shared with CURSOR_CLI_PATH.
test('stripWrappingQuotes trims and removes one pair of matching wrapping quotes', () => {
  assert.equal(stripWrappingQuotes('  /usr/local/bin/claude  '), '/usr/local/bin/claude');
  assert.equal(stripWrappingQuotes('"C:\\Program Files\\Claude\\claude.exe"'), 'C:\\Program Files\\Claude\\claude.exe');
  assert.equal(stripWrappingQuotes(" '/opt/cursor tools/cursor-agent' "), '/opt/cursor tools/cursor-agent');
  assert.equal(stripWrappingQuotes('""/x""'), '"/x"');
});

test('stripWrappingQuotes keeps inner whitespace, mismatched quotes and a lone quote as Claude always did', () => {
  assert.equal(stripWrappingQuotes('" /x "'), ' /x ');
  assert.equal(stripWrappingQuotes('"/x\''), '"/x\'');
  assert.equal(stripWrappingQuotes('"/x'), '"/x');
  assert.equal(stripWrappingQuotes('"'), '');
  assert.equal(stripWrappingQuotes(''), '');
});
