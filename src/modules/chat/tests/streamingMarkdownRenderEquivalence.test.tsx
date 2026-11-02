import assert from 'node:assert/strict';

import { test } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';

import { splitStreamingMarkdown } from '@/modules/chat/utils/streamingMarkdown';

/**
 * The property the split exists to preserve: rendering `settled` and `pending`
 * as two sibling documents must equal rendering the whole message as one.
 * Asserting `settled + pending === content` is not enough — that holds for any
 * slice point. This runs the real remark/rehype pipeline over both forms.
 */

// Same plugin set as Markdown.tsx.
const remarkPlugins = [remarkGfm, [remarkMath, { singleDollarTextMath: false }]] as never;
const rehypePlugins = [rehypeKatex] as never;

/**
 * react-markdown emits a literal "\n" text node between block elements. It is
 * insignificant whitespace between blocks and the split simply has one fewer of
 * them at the seam, so it is normalized out of both sides equally. Newlines
 * inside <pre> are unaffected: they never sit between a '>' and a '<', and the
 * split never lands inside a fence anyway.
 */
const normalizeBlockWhitespace = (html: string): string => html.replace(/>\n</g, '><');

const renderWhole = (content: string): string =>
  normalizeBlockWhitespace(renderToStaticMarkup(
    React.createElement(ReactMarkdown, { remarkPlugins, rehypePlugins }, content),
  ));

const renderSplit = (content: string): string => {
  const { settled, pending } = splitStreamingMarkdown(content);
  return normalizeBlockWhitespace(renderToStaticMarkup(
    React.createElement(
      React.Fragment,
      null,
      settled
        ? React.createElement(ReactMarkdown, { remarkPlugins, rehypePlugins, key: 's' }, settled)
        : null,
      pending
        ? React.createElement(ReactMarkdown, { remarkPlugins, rehypePlugins, key: 'p' }, pending)
        : null,
    ),
  ));
};

const assertRendersIdentically = (content: string, label: string) => {
  const { settled, pending } = splitStreamingMarkdown(content);
  assert.equal(settled + pending, content, `${label}: split lost or duplicated text`);
  assert.equal(
    renderSplit(content),
    renderWhole(content),
    `${label}: split renders differently from the whole document`,
  );
};

/** Every prefix models one 100ms streaming tick. */
const assertEveryPrefixRendersIdentically = (content: string, label: string) => {
  for (let end = 1; end <= content.length; end++) {
    assertRendersIdentically(content.slice(0, end), `${label} @${end}`);
  }
};

const FIXTURES: Array<[string, string]> = [
  ['plain paragraphs', 'First paragraph here.\n\nSecond paragraph here.\n\nThird one still writing'],
  ['headings', '# A title\n\nSome body text.\n\n## A subtitle\n\nMore body text'],
  ['fenced code', 'Intro line.\n\n```ts\nconst a = 1;\n\nconst b = 2;\n```\n\nAfter the block'],
  ['nested fences', 'Intro.\n\n~~~markdown\n```\ncode\n\nmore\n```\n~~~\n\nDone'],
  ['tilde inside backticks', 'Intro.\n\n```md\n~~~\nfoo\n\nbar\n```\n\nEnd'],
  ['display math', 'Text before.\n\n$$\na = b\n\nc = d\n$$\n\nText after'],
  ['ordered list', 'Steps:\n\n1. first\n\n2. second\n\n3. third'],
  ['bullet list', 'Items:\n\n- alpha\n\n- beta\n\n- gamma'],
  ['blockquote', '> quoted line\n\n> continued quote\n\nAfter'],
  ['table', '| a | b |\n| - | - |\n| 1 | 2 |\n\nAfter the table'],
  ['link reference definition', 'See [the docs][x] for more information.\n\n[x]: https://example.com'],
  ['footnote', 'A claim that needs a source[^1].\n\n[^1]: The source of the claim.'],
  ['tab indented code', 'Paragraph:\n\n\tline one\n\n\tline two'],
  ['four space indented code', 'Paragraph:\n\n    line one\n\n    line two'],
  ['thematic break', 'Above the rule.\n\n---\n\nBelow the rule'],
  ['mixed', '# Report\n\nIntro text.\n\n```js\nrun();\n```\n\n- point one\n- point two\n\nClosing words'],
];

for (const [label, content] of FIXTURES) {
  test(`the split renders identically to the whole document: ${label}`, () => {
    assertRendersIdentically(content, label);
  });
}

for (const [label, content] of FIXTURES) {
  test(`every streaming prefix renders identically: ${label}`, () => {
    assertEveryPrefixRendersIdentically(content, label);
  });
}
