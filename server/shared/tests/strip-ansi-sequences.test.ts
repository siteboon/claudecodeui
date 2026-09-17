import assert from 'node:assert/strict';
import test from 'node:test';

import { stripAnsiSequences } from '@/shared/utils.js';

test('strips the SGR colors a CLI writes around its own warnings', () => {
  const styled = '\u001B[93m\u001B[1m! \u001B[0m\u001B[0mpermission requested: external_directory';
  assert.equal(stripAnsiSequences(styled), '! permission requested: external_directory');
});

test('strips CSI cursor control, including the 8-bit introducer', () => {
  assert.equal(stripAnsiSequences('a\u001B[2Kb\u001B[?25lc'), 'abc');
  assert.equal(stripAnsiSequences('a\u009B31mb'), 'ab');
});

test('strips an OSC sequence with either terminator, without eating the rest', () => {
  assert.equal(stripAnsiSequences('\u001B]0;title\u0007done'), 'done');
  assert.equal(stripAnsiSequences('\u001B]8;;https://example.com\u001B\\link'), 'link');
});

test('strips other ECMA-48 escape sequences such as charset selection', () => {
  assert.equal(stripAnsiSequences('\u001B(Bplain'), 'plain');
});

test('leaves text without escape sequences untouched', () => {
  assert.equal(stripAnsiSequences('plain [93m-looking text'), 'plain [93m-looking text');
});

test('strips a CSI sequence that carries a private parameter byte', () => {
  assert.equal(stripAnsiSequences('a\u001B[>cb'), 'ab');
});

test('stops an unterminated OSC at the next escape, so later styling still strips', () => {
  assert.equal(
    stripAnsiSequences('\u001B]0;unterminated\u001B[31mred\u001B[0m'),
    '0;unterminatedred',
  );
});

test('reduces a styling-only chunk to an empty string', () => {
  assert.equal(stripAnsiSequences('\u001B[0m\u001B[2K'), '');
});
