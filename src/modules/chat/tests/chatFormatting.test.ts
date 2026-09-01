import React from 'react';

import { render } from '@testing-library/react';
import assert from 'node:assert/strict';

import { test } from 'vitest';

import { stripProposedPlanEnvelope } from '@/modules/chat/utils/chatFormatting';
import { Markdown } from '@/modules/chat/transcript/Markdown';
import StreamingMarkdown from '@/modules/chat/transcript/StreamingMarkdown';

test('stripProposedPlanEnvelope removes a complete outer plan envelope', () => {
  assert.equal(
    stripProposedPlanEnvelope('<proposed_plan>\n# Session Timeline\n\nPlan body\n</proposed_plan>'),
    '# Session Timeline\n\nPlan body',
  );
});

test('stripProposedPlanEnvelope removes the opening tag while a plan is streaming', () => {
  assert.equal(
    stripProposedPlanEnvelope('<proposed_plan>\n# Partial plan'),
    '# Partial plan',
  );
});

test('stripProposedPlanEnvelope preserves tags that are not the outer envelope', () => {
  const content = 'Use `<proposed_plan>` only for plans.';
  assert.equal(stripProposedPlanEnvelope(content), content);
});

test('stripProposedPlanEnvelope preserves an unmatched terminal closing tag', () => {
  const content = 'Ordinary text that mentions a terminal tag.\n</proposed_plan>';
  assert.equal(stripProposedPlanEnvelope(content), content);
});

const renderMarkdown = (content: string) =>
  render(React.createElement(Markdown, { children: content }));

test('Markdown renders bracket and parenthesis LaTeX without corrupting commands', () => {
  const content =
    String.raw`\[ \text{fixed net} = \text{fixed gross} \]` +
    '\n\n' +
    String.raw`rate \( \rho \times 2 \) done`;
  const { container } = renderMarkdown(content);

  assert.equal(container.querySelectorAll('.katex').length, 2);
  assert.equal(container.textContent?.includes('\t'), false, String.raw`\text must not become a tab`);
});

test('Markdown leaves currency prose outside math', () => {
  const content = 'Tiered fees for $200k exposure, and the fixed-$100k stats use it.';
  const { container } = renderMarkdown(content);

  assert.equal(container.querySelector('.katex'), null);
  assert.equal(container.textContent, content);
});

test('Markdown keeps LaTeX-looking delimiters inside fenced and inline code literal', () => {
  const fenced = String.raw`\[ \theta \]`;
  const inline = String.raw`\( \rho \)`;
  const tildeFenced = String.raw`\[ \times \]`;
  const unfinishedFenced = String.raw`\( \sigma \)`;
  const content = [
    '````',
    '```',
    fenced,
    '```',
    '````',
    '',
    `Use \`\`${inline}\`\` literally.`,
    '',
    '~~~',
    tildeFenced,
    '~~~~',
    '',
    '`````',
    unfinishedFenced,
  ].join('\n');
  const { container } = renderMarkdown(content);
  const code = Array.from(container.querySelectorAll('code'), (element) => element.textContent);

  assert.equal(container.querySelector('.katex'), null);
  for (const literal of [fenced, inline, tildeFenced, unfinishedFenced]) {
    assert.ok(code.some((value) => value?.includes(literal)), `${literal} must stay literal`);
  }
});

test('completed replies render normalized LaTeX through MarkdownBody', () => {
  const content = String.raw`\[ \theta_{t+1} = \theta_t \times 2 \]`;
  const { container } = render(
    React.createElement(StreamingMarkdown, { content, isStreaming: false }),
  );

  assert.equal(container.querySelectorAll('.katex').length, 1);
});

test('streaming replies render normalized LaTeX through MarkdownBody', () => {
  const content = 'Before.\n\n' + String.raw`\( \rho \times 2 \)`;
  const { container } = render(
    React.createElement(StreamingMarkdown, { content, isStreaming: true }),
  );

  assert.equal(container.querySelectorAll('.katex').length, 1);
});

test('Markdown keeps escaped LaTeX delimiters out of math', () => {
  const escapedPair = String.raw`\\[ \theta \\]`;
  const escapedCloser = String.raw`\[ \rho \\]`;
  const { container } = renderMarkdown(`${escapedPair}\n\n${escapedCloser}`);

  assert.equal(container.querySelector('.katex'), null);
  assert.equal(container.textContent?.includes('$$'), false, 'delimiters must not become math');
});
