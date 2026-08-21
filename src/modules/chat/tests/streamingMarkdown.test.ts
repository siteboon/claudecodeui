import assert from 'node:assert/strict';

import { test } from 'vitest';

import { splitStreamingMarkdown } from '@/modules/chat/utils/streamingMarkdown';

/**
 * The split is only sound if `settled + pending === content` and the two halves
 * render the same as the whole. Every case below either asserts a safe boundary
 * or asserts that a context-sensitive construct is kept intact.
 */

const assertLossless = (content: string) => {
  const { settled, pending } = splitStreamingMarkdown(content);
  assert.equal(settled + pending, content, 'split must not lose or duplicate text');
};

test('an empty message splits into nothing', () => {
  assert.deepEqual(splitStreamingMarkdown(''), { settled: '', pending: '' });
});

test('a message with no completed block is entirely pending', () => {
  const content = 'The first sentence is still being written';
  assert.deepEqual(splitStreamingMarkdown(content), { settled: '', pending: content });
  assertLossless(content);
});

test('a completed paragraph settles and the partial one stays pending', () => {
  const content = 'First paragraph.\n\nSecond para still stre';
  const { settled, pending } = splitStreamingMarkdown(content);

  assert.equal(settled, 'First paragraph.\n\n');
  assert.equal(pending, 'Second para still stre');
  assertLossless(content);
});

test('the boundary advances to the last completed block', () => {
  const content = 'One.\n\nTwo.\n\nThree partial';
  const { settled, pending } = splitStreamingMarkdown(content);

  assert.equal(settled, 'One.\n\nTwo.\n\n');
  assert.equal(pending, 'Three partial');
});

test('an unterminated code fence keeps the whole block pending', () => {
  const content = 'Intro.\n\n```ts\nconst a = 1;\n\nconst b = 2;\n';
  const { settled, pending } = splitStreamingMarkdown(content);

  assert.equal(settled, 'Intro.\n\n');
  assert.ok(pending.startsWith('```ts'), 'the open fence must stay in one piece');
  assertLossless(content);
});

test('a closed code fence can be settled', () => {
  const content = '```ts\nconst a = 1;\n```\n\nAfter the block';
  const { settled, pending } = splitStreamingMarkdown(content);

  assert.equal(settled, '```ts\nconst a = 1;\n```\n\n');
  assert.equal(pending, 'After the block');
});

test('a blank line inside a loose list is not a boundary', () => {
  // Splitting here would restart the numbering at 1 in the second half.
  const content = '1. first\n\n2. second\n\n3. third partial';
  const { settled } = splitStreamingMarkdown(content);

  assert.equal(settled, '', 'must never split a list');
});

test('a blank line between bullet items is not a boundary', () => {
  const content = '- alpha\n\n- beta\n\n- gamma partial';
  assert.equal(splitStreamingMarkdown(content).settled, '');
});

test('a blank line adjacent to a blockquote is not a boundary', () => {
  const content = '> quoted line\n\n> continued quote partial';
  assert.equal(splitStreamingMarkdown(content).settled, '');
});

test('a blank line adjacent to a table is not a boundary', () => {
  const content = '| a | b |\n| - | - |\n\n| 1 | 2 |';
  assert.equal(splitStreamingMarkdown(content).settled, '');
});

test('a paragraph before a list settles without splitting the list', () => {
  const content = 'Here are the steps.\n\n- first\n- second partial';
  const { settled, pending } = splitStreamingMarkdown(content);

  assert.equal(settled, '', 'the list start is context-sensitive, so no split yet');
  assert.equal(pending, content);
});

test('a heading is a safe boundary', () => {
  const content = '# Title\n\nBody text still coming';
  const { settled, pending } = splitStreamingMarkdown(content);

  assert.equal(settled, '# Title\n\n');
  assert.equal(pending, 'Body text still coming');
});

test('content ending exactly on a boundary leaves nothing pending', () => {
  const content = 'Done.\n\n';
  const { settled, pending } = splitStreamingMarkdown(content);

  assert.equal(settled, 'Done.\n\n');
  assert.equal(pending, '');
});

test('the settled prefix only grows as more of the reply arrives', () => {
  const full = 'Alpha para.\n\nBeta para.\n\nGamma still going';
  let previousSettledLength = 0;

  for (let end = 1; end <= full.length; end++) {
    const chunk = full.slice(0, end);
    const { settled } = splitStreamingMarkdown(chunk);
    assertLossless(chunk);
    assert.ok(
      settled.length >= previousSettledLength,
      `settled prefix shrank at length ${end}: ${settled.length} < ${previousSettledLength}`,
    );
    previousSettledLength = settled.length;
  }
});

test('every prefix of a fenced reply stays lossless', () => {
  const full = 'Intro.\n\n```js\nconst x = 1;\n```\n\nOutro para.\n\nTail';
  for (let end = 1; end <= full.length; end++) {
    assertLossless(full.slice(0, end));
  }
});

test('a self-closing $$x$$ line does not leave math tracking stuck open', () => {
  // Toggling on a line that opens and closes in one go would suppress every
  // later boundary, silently disabling the optimisation for the rest of the reply.
  const content = 'Intro.\n\n$$E = mc^2$$\n\nA settled paragraph.\n\nStill writing';
  const { settled, pending } = splitStreamingMarkdown(content);

  assert.equal(pending, 'Still writing');
  assert.ok(settled.includes('A settled paragraph.'));
});

test('a blank line inside an unterminated $$ block is not a boundary', () => {
  // This is the shape mid-stream: the closing $$ has not arrived yet.
  const content = 'Intro.\n\n$$\na = b\n\nc = d';
  const { settled, pending } = splitStreamingMarkdown(content);

  assert.equal(settled, 'Intro.\n\n', 'the open math block must stay in one piece');
  assert.equal(pending, '$$\na = b\n\nc = d');
});

test('a closed $$ block can be settled once its delimiter arrives', () => {
  const content = 'Intro.\n\n$$\na = b\n\nc = d\n$$\n\nAfter';
  const { settled, pending } = splitStreamingMarkdown(content);

  assert.equal(settled, 'Intro.\n\n$$\na = b\n\nc = d\n$$\n\n');
  assert.equal(pending, 'After');
});
