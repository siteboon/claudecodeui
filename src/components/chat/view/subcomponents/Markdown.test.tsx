import assert from 'node:assert/strict';
import test from 'node:test';

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ReactMarkdown from 'react-markdown';
import rehypeKatex from 'rehype-katex';

import { createChatMarkdownRemarkPlugins } from './markdownPlugins';

function renderMarkdown(content: string): string {
  return renderToStaticMarkup(
    <ReactMarkdown
      remarkPlugins={createChatMarkdownRemarkPlugins()}
      rehypePlugins={[rehypeKatex]}
    >
      {content}
    </ReactMarkdown>,
  );
}

test('Markdown renders dollar amounts as text instead of inline KaTeX', () => {
  const html = renderMarkdown('The monthly cost is $12.99 per seat and the annual cost is $120.');

  assert.equal(html.includes('katex'), false);
  assert.match(html, /12\.99/);
  assert.match(html, /120/);
});

test('Markdown still renders double-dollar math with KaTeX', () => {
  const html = renderMarkdown('$$x + y$$');

  assert.equal(html.includes('katex'), true);
});
