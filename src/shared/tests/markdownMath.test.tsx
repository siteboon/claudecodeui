import assert from 'node:assert/strict';

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ReactMarkdown from 'react-markdown';
import rehypeKatex from 'rehype-katex';
import remarkGfm from 'remark-gfm';
import { test } from 'vitest';

import { MARKDOWN_MATH_REMARK_PLUGINS } from '@/shared/markdownMath';

const remarkPlugins = [remarkGfm, ...MARKDOWN_MATH_REMARK_PLUGINS] as never;
const rehypePlugins = [rehypeKatex] as never;

const renderMarkdown = (content: string): string =>
  renderToStaticMarkup(
    React.createElement(ReactMarkdown, { remarkPlugins, rehypePlugins }, content),
  );

test('renders TeX-style inline math with KaTeX', () => {
  const html = renderMarkdown(String.raw`The result is \(x^2 + y^2\).`);

  assert.match(html, /class="katex"/);
  assert.doesNotMatch(html, /\\\(|\\\)/);
});

test('renders same-line TeX-style display math with KaTeX display mode', () => {
  const html = renderMarkdown(String.raw`\[E = mc^2\]`);

  assert.match(html, /class="katex-display"/);
});

test('renders multiline TeX-style display math', () => {
  const html = renderMarkdown(String.raw`Before
\[
\frac{a}{b}
\]
After`);

  assert.match(html, /class="katex-display"/);
  assert.match(html, /Before/);
  assert.match(html, /After/);
});

test('keeps TeX line-break options inside display math', () => {
  const html = renderMarkdown(String.raw`\[
\begin{cases}
x \\[1em]
y
\end{cases}
\]`);

  assert.match(html, /class="katex-display"/);
  assert.doesNotMatch(html, /katex-error/);
});

test('does not parse TeX delimiters inside inline or fenced code', () => {
  const html = renderMarkdown('Inline: `\\(x\\)`\n\n```text\n\\[y\\]\n```');

  assert.doesNotMatch(html, /class="katex(?:-display)?"/);
  assert.match(html, /\\\(x\\\)/);
  assert.match(html, /\\\[y\\\]/);
});

test('leaves escaped and unclosed TeX delimiters as text', () => {
  const escaped = renderMarkdown(String.raw`Literal \\(x\) text.`);
  const unclosed = renderMarkdown(String.raw`\[not closed`);

  assert.doesNotMatch(escaped, /class="katex(?:-display)?"/);
  assert.doesNotMatch(unclosed, /class="katex(?:-display)?"/);
  assert.match(escaped, /\\\(x\)/);
  assert.match(unclosed, /\[not closed/);
});

test('preserves existing dollar-delimited math behavior', () => {
  const html = renderMarkdown('Price $5 stays text.\n\n$$\nx + y\n$$');

  assert.match(html, /Price \$5 stays text/);
  assert.match(html, /class="katex-display"/);
});
