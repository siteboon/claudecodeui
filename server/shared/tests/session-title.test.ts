import assert from 'node:assert/strict';
import test from 'node:test';

import { SESSION_TITLE_MAX_WIDTH, truncateSessionTitle } from '@/shared/utils.js';

/**
 * Session titles come from user text, and a Chinese prompt has no spaces: the
 * old word-count cut kept the whole first sentence and filled the sidebar row.
 * The budget is measured in half-width units, so sixteen Chinese characters and
 * thirty-two Latin letters both fit.
 */

test('a title that already fits is returned untouched', () => {
  assert.equal(truncateSessionTitle('加手机网页界面'), '加手机网页界面');
  assert.equal(truncateSessionTitle('super-agent2'), 'super-agent2');
});

test('a Chinese sentence is cut to the width budget plus an ellipsis', () => {
  const cut = truncateSessionTitle('聊天会话加载延时问题：在有 queue 会话的情况');

  assert.equal(cut, '聊天会话加载延时问题：在有…');
  // Thirteen full-width characters plus the ellipsis fit the budget with room
  // to spare, because the cut lands on a word boundary just below it.
  assert.equal([...cut].length, 14);
});

test('whitespace is collapsed and the ends trimmed', () => {
  assert.equal(truncateSessionTitle('  多  空格\n换行  '), '多 空格 换行');
});

test('empty input stays empty so the caller can apply its own fallback', () => {
  assert.equal(truncateSessionTitle(''), '');
  assert.equal(truncateSessionTitle('   '), '');
});

test('an early comma does not swallow the rest of the title', () => {
  // Breaking at the comma would leave ten units on screen out of a thirty-unit
  // budget, so the cut runs on to the character boundary instead.
  const cut = truncateSessionTitle('先看日志，再决定要不要改这里的实现细节，然后跑测试');

  assert.equal(cut, '先看日志，再决定要不要改这里的…');
});

test('a break near the end of the budget is taken', () => {
  // The comma lands just inside the budget, so the title ends on the phrase
  // rather than a dangling character.
  assert.equal(truncateSessionTitle('一二三四五六七八九十甲乙丙，丁戊己庚辛'), '一二三四五六七八九十甲乙丙…');
});

test('a latin word is never split in half', () => {
  // The whole word survives even though the budget would have cut inside the
  // next one, and the space in front of the ellipsis is dropped.
  assert.equal(truncateSessionTitle('investigate the streaming regression'), 'investigate the streaming…');
});

test('an unbreakable latin word falls back to a hard cut', () => {
  assert.equal(truncateSessionTitle('supercalifragilisticexpialidocious'), 'supercalifragilisticexpialidoc…');
});

test('the documented budget is sixteen double-width characters', () => {
  assert.equal(SESSION_TITLE_MAX_WIDTH, 32);
});
