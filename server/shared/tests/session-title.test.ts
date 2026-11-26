import assert from 'node:assert/strict';
import test from 'node:test';

import { SESSION_TITLE_MAX_WIDTH, truncateSessionTitle } from '@/shared/utils.js';

/**
 * Session titles come from user text, and a Chinese prompt has no spaces: the
 * old word-count cut kept the whole first sentence and filled the sidebar row.
 * The budget is measured in half-width units, so eight Chinese characters or
 * sixteen Latin letters both fit.
 */

test('a title that already fits is returned untouched', () => {
  assert.equal(truncateSessionTitle('加手机网页界面'), '加手机网页界面');
  assert.equal(truncateSessionTitle('super-agent2'), 'super-agent2');
});

test('a Chinese sentence is cut to eight characters plus an ellipsis', () => {
  const cut = truncateSessionTitle('聊天会话加载延时问题：在有 queue 会话的情况');

  assert.equal(cut, '聊天会话加载延…');
  // Seven full-width characters plus the ellipsis stay inside the budget.
  assert.equal([...cut].length, 8);
});

test('whitespace is collapsed and the ends trimmed', () => {
  assert.equal(truncateSessionTitle('  多  空格\n换行  '), '多 空格 换行');
});

test('empty input stays empty so the caller can apply its own fallback', () => {
  assert.equal(truncateSessionTitle(''), '');
  assert.equal(truncateSessionTitle('   '), '');
});

test('an early comma does not swallow the rest of the title', () => {
  // Breaking at the comma would leave five characters on screen out of a
  // fourteen-unit budget, so the cut runs on to the character boundary.
  assert.equal(truncateSessionTitle('先看日志，再决定要不要改这里'), '先看日志，再决…');
});

test('a break near the end of the budget is taken', () => {
  // The comma lands just inside the budget, so the title ends on the phrase
  // rather than a dangling character.
  assert.equal(truncateSessionTitle('一二三四五，六七八九十'), '一二三四五…');
});

test('a latin word is never split in half', () => {
  // The whole word survives even though the budget would have cut inside it,
  // and the space in front of the ellipsis is dropped.
  assert.equal(truncateSessionTitle('investigate the streaming regression'), 'investigate…');
});

test('an unbreakable latin word falls back to a hard cut', () => {
  assert.equal(truncateSessionTitle('supercalifragilisticexpialidocious'), 'supercalifragi…');
});

test('the documented budget is eight double-width characters', () => {
  assert.equal(SESSION_TITLE_MAX_WIDTH, 16);
});
