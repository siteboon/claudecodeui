import assert from 'node:assert/strict';

import { fireEvent, render, screen } from '@testing-library/react';
import { test } from 'vitest';

import { Markdown } from '@/modules/chat/transcript/Markdown';
import StreamingMarkdown from '@/modules/chat/transcript/StreamingMarkdown';
import { ToolErrorDisplay } from '@/modules/chat/tools/ToolErrorDisplay';

/**
 * Regression guard for #899: text the model wrote line by line — a file quoted
 * without a fence, code, `**A:** x` / `**B:** y` lines — was joined into one
 * wrapped paragraph by CommonMark's soft breaks, while the message's MD copy
 * kept every line. Transcript markdown now renders a single newline as a break.
 */

const LINES = 'Line one of a paragraph\nLine two of the same paragraph\nLine three of the same paragraph';

// Chat's markdown draws a paragraph as a <div>, so this reads the <br>s and
// the text rather than looking for <p>.
const assertKeepsLines = (container: HTMLElement) => {
  assert.equal(container.querySelectorAll('br').length, 2, 'each newline is a <br>');
  const lines = LINES.split('\n');
  const breakHost = container.querySelector('br')?.parentElement;
  assert.deepEqual(breakHost?.textContent?.split('\n'), lines, 'the lines stay together, one per row');
};

test('an assistant reply keeps the line breaks of unfenced text', () => {
  const { container } = render(<StreamingMarkdown content={`Here is the file:\n\n${LINES}`} isStreaming={false} />);
  assertKeepsLines(container);
});

test('a reply still being streamed keeps its line breaks too', () => {
  const { container } = render(<StreamingMarkdown content={`Intro\n\n${LINES}`} isStreaming />);
  assert.equal(container.querySelectorAll('br').length, 2);
});

test('thinking and other <Markdown> text renders one line per newline', () => {
  const { container } = render(<Markdown>{LINES}</Markdown>);
  assertKeepsLines(container);
});

test('markdown structure is unchanged: headings, lists and fenced code', () => {
  const { container } = render(
    <Markdown>{'# Title\n\n- one\n- two\n\n```text\nfirst\nsecond\n```'}</Markdown>,
  );
  assert.equal(container.querySelectorAll('h1').length, 1);
  assert.equal(container.querySelectorAll('li').length, 2);
  assert.equal(container.querySelectorAll('br').length, 0, 'no <br> inside lists or code blocks');
  assert.match(container.textContent ?? '', /first\nsecond/);
});

test('a caller can still opt out and get CommonMark soft breaks', () => {
  const { container } = render(<Markdown breaks={false}>{LINES}</Markdown>);
  assert.equal(container.querySelectorAll('br').length, 0);
});

test('a multi-line tool error keeps its lines when expanded', () => {
  const { container } = render(<ToolErrorDisplay label="Error" content={LINES} />);
  fireEvent.click(screen.getByRole('button'));
  assertKeepsLines(container);
});
