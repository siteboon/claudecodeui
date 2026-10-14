import assert from 'node:assert/strict';
import test from 'node:test';

import { collapseHomePath } from './pathDisplay';

const HOME = '/Users/alex';

test('collapseHomePath collapses the home dir to a tilde', () => {
  assert.equal(collapseHomePath('/Users/alex/Documents/repo', HOME), '~/Documents/repo');
});

test('collapseHomePath returns ~ for the home dir itself', () => {
  assert.equal(collapseHomePath('/Users/alex', HOME), '~');
});

test('collapseHomePath tolerates a trailing separator on the home dir', () => {
  assert.equal(collapseHomePath('/Users/alex/x', '/Users/alex/'), '~/x');
  assert.equal(collapseHomePath('/Users/alex', '/Users/alex/'), '~');
});

test('collapseHomePath does not match a sibling with a shared prefix', () => {
  assert.equal(collapseHomePath('/Users/alexander/repo', HOME), '/Users/alexander/repo');
});

test('collapseHomePath leaves paths outside the home dir untouched', () => {
  assert.equal(collapseHomePath('/opt/homebrew/bin', HOME), '/opt/homebrew/bin');
});

test('collapseHomePath returns the input when homedir is missing', () => {
  assert.equal(collapseHomePath('/Users/alex/repo', null), '/Users/alex/repo');
  assert.equal(collapseHomePath('/Users/alex/repo', undefined), '/Users/alex/repo');
  assert.equal(collapseHomePath('/Users/alex/repo', ''), '/Users/alex/repo');
});

test('collapseHomePath never collapses when home resolves to root', () => {
  assert.equal(collapseHomePath('/Users/alex/repo', '/'), '/Users/alex/repo');
});

test('collapseHomePath preserves a Windows separator', () => {
  assert.equal(collapseHomePath('C:\\Users\\alex\\repo', 'C:\\Users\\alex'), '~\\repo');
});

test('collapseHomePath returns an empty input unchanged', () => {
  assert.equal(collapseHomePath('', HOME), '');
});
