import assert from 'node:assert/strict';
import test from 'node:test';

import { ClaudeSessionsProvider } from '@/modules/providers/list/claude/claude-sessions.provider.js';

const provider = new ClaudeSessionsProvider();
const SESSION_ID = 'claude-pasted-content-1';

/**
 * Claude Code 2.1.282+ stores a paste wrapped as
 * `<pasted_content id="ID">\nBODY\n</pasted_content id="ID">` (the closing tag
 * carries the id too, so it is not valid XML). The CLI shows the pasted text, so
 * the normalized user message should too. Synthetic data only.
 */
const wrap = (id: string, body: string) =>
  `<pasted_content id="${id}">\n${body}\n</pasted_content id="${id}">`;

const userText = (content: string) => {
  const [row, ...rest] = provider.normalizeMessage({
    type: 'user',
    uuid: 'u-1',
    timestamp: '2026-01-01T00:00:00.000Z',
    message: { role: 'user', content },
  }, SESSION_ID);
  assert.equal(rest.length, 0);
  assert.equal(row.kind, 'text');
  assert.equal(row.role, 'user');
  return row.content;
};

test('a paste on its own shows the pasted text byte for byte, without the wrapper or its newlines', () => {
  assert.equal(userText(`\n\n${wrap('7b82', 'line one\n  line two')}\n`), 'line one\n  line two');
});

test('typed text around a paste stays in place', () => {
  const text = `please look at this\n\n${wrap('26bf', 'stack trace here')}\n\nand tell me why`;
  assert.equal(userText(text), 'please look at this\n\nstack trace here\n\nand tell me why');
});

test('two pastes with different ids are both unwrapped, in order', () => {
  assert.equal(userText(`${wrap('aa11', 'first')}\n${wrap('bb22', 'second')}`), 'first\nsecond');
});

test('a paste that contains angle-bracket text or a lookalike opening tag keeps it', () => {
  const body = 'const x = <div>hi</div>;\n<pasted_content id="zz99">not closed here';
  assert.equal(userText(wrap('c0de', body)), body);
});

test('a closing tag with a different id leaves the message as it was', () => {
  const text = '<pasted_content id="aa11">\nbody\n</pasted_content id="bb22">';
  assert.equal(userText(text), text);
});

test('an unclosed, unopened or bare tag is never half-stripped', () => {
  for (const text of [
    '<pasted_content id="aa11">\nno closing tag',
    'no opening tag\n</pasted_content id="aa11">',
    'the words <pasted_content> in prose',
  ]) {
    assert.equal(userText(text), text);
  }
});

test('a message without any wrapper keeps its surrounding whitespace', () => {
  assert.equal(userText('  plain text\n'), '  plain text\n');
});
