import assert from 'node:assert/strict';

import { render } from '@testing-library/react';
import { test, vi } from 'vitest';

import { Markdown } from '@/modules/chat/transcript/Markdown';
import StreamingMarkdown from '@/modules/chat/transcript/StreamingMarkdown';
// Type-only, so it is erased before vi.mock's hoisted factory runs.
import type * as StreamingMarkdownUtils from '@/modules/chat/utils/streamingMarkdown';

/** Records what the component asks the splitter for, without changing it. */
const splitCalls: string[] = [];
vi.mock('@/modules/chat/utils/streamingMarkdown', async (importOriginal) => {
  const actual = await importOriginal<typeof StreamingMarkdownUtils>();
  return {
    ...actual,
    splitStreamingMarkdown: (content: string) => {
      splitCalls.push(content);
      return actual.splitStreamingMarkdown(content);
    },
  };
});

/**
 * streamingMarkdownRenderEquivalence.test.tsx proves the split point is safe by
 * feeding both halves through a bare ReactMarkdown. This renders the real
 * components instead, so the app's own component overrides, the single prose
 * container and the injected syntax theme are all in the picture.
 */

const PROSE = 'prose prose-sm max-w-none dark:prose-invert';

/** Insignificant text nodes between blocks are not part of the rendered output. */
const normalize = (html: string) => html.replace(/>\s+</g, '><').trim();

const FIXTURES: Record<string, string> = {
  'plain paragraphs': 'First paragraph.\n\nSecond paragraph.\n\nThird one.\n',
  'a list after prose': 'Here is a plan:\n\nStep one\n\n- alpha\n- beta\n\nDone.\n',
  'a fenced block': 'Before.\n\n```ts\nconst a = 1;\n```\n\nAfter.\n',
  'a table': 'Intro.\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\nOutro.\n',
  'a blockquote': 'Intro.\n\n> quoted\n> lines\n\nOutro.\n',
  'a link reference': 'See [it][ref].\n\n[ref]: https://example.test\n\nEnd.\n',
  'nested fences': 'Doc:\n\n````md\n```ts\nconst a = 1;\n```\n````\n\nEnd.\n',
  // A blank line between items makes the list loose, so every item gains a <p>.
  // Splitting there would render two tight lists instead of one loose one.
  'a loose list': 'Plan:\n\n- alpha\n\n- beta\n\nEnd.\n',
  // The indented line belongs to the list item above it; split off, it is a
  // paragraph of its own.
  'a list item continuation': 'Plan:\n\n- alpha\n\n  still alpha\n\nEnd.\n',
  // A blank line inside an indented code block does not end it, so splitting
  // there would render two code blocks instead of one.
  'indented code with a blank line': 'Intro.\n\n    line one\n\n    line two\n\nEnd.\n',
  'consecutive blockquotes': 'Intro.\n\n> a\n\n> b\n\nEnd.\n',
  'a table then a stray row': 'Intro.\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\n| 3 | 4 |\n\nEnd.\n',
  'a footnote definition': 'Text[^1].\n\n[^1]: the note\n\nEnd.\n',
};

for (const [name, content] of Object.entries(FIXTURES)) {
  test(`the split render matches the unsplit render: ${name}`, () => {
    // Every prefix, because the split point moves as the reply streams in and a
    // bad boundary only shows up at the prefix that crosses it.
    for (let length = 1; length <= content.length; length += 1) {
      const prefix = content.slice(0, length);

      const streamed = render(<StreamingMarkdown content={prefix} isStreaming className={PROSE} />);
      const whole = render(<Markdown className={PROSE}>{prefix}</Markdown>);

      assert.equal(
        normalize(streamed.container.innerHTML),
        normalize(whole.container.innerHTML),
        `prefix of length ${length} renders differently when split`,
      );

      streamed.unmount();
      whole.unmount();
    }
  });
}

const renderStreaming = (content: string) =>
  render(<StreamingMarkdown content={content} isStreaming className={PROSE} />);

test('both halves live in one prose container, so block margins still collapse', () => {
  // Two prose containers put the settled and pending halves in separate
  // Tailwind Typography scopes, which applied `> :first-child { margin-top: 0 }`
  // to the pending half as well and closed the gap between them.
  const { container } = renderStreaming('First paragraph.\n\nSecond paragraph still being writ');

  assert.equal(container.children.length, 1, 'exactly one container element');
  assert.equal(container.firstElementChild?.className, PROSE);
});

test('the settled and pending halves are siblings inside it, not nested', () => {
  const { container } = renderStreaming('First paragraph.\n\nSecond paragraph still being writ');

  // The app renders a paragraph as a spacing div, not a <p>, which is exactly
  // why this asserts on the real components rather than a bare ReactMarkdown.
  const blocks = container.firstElementChild?.children;
  assert.equal(blocks?.length, 2, 'the settled block and the pending block');
});

test('an empty half contributes no wrapper of its own', () => {
  // A message whose first block is still open has no settled half at all.
  const { container } = renderStreaming('Still writing the very first');

  assert.equal(container.firstElementChild?.children.length, 1);
});

test('the finished reply renders exactly what <Markdown> would', () => {
  const content = 'A paragraph.\n\n- alpha\n- beta\n\n```ts\nconst a = 1;\n```\n';

  const settled = render(<StreamingMarkdown content={content} isStreaming={false} className={PROSE} />);
  const whole = render(<Markdown className={PROSE}>{content}</Markdown>);

  assert.equal(normalize(settled.container.innerHTML), normalize(whole.container.innerHTML));
});

test('a finished reply is rendered whole, not split into two parses', () => {
  // The DOM is identical either way — the equivalence tests above are exactly
  // that guarantee — so this asserts the work instead. Splitting a completed
  // reply hands remark two documents where one would do, and a loaded
  // transcript pays that for every assistant message it renders.
  const content = 'First paragraph.\n\nSecond paragraph still being writ';

  splitCalls.length = 0;
  render(<StreamingMarkdown content={content} isStreaming={false} className={PROSE} />);
  assert.deepEqual(splitCalls, [], 'a finished reply has nothing left to grow');

  render(<StreamingMarkdown content={content} isStreaming className={PROSE} />);
  assert.deepEqual(splitCalls, [content], 'a streaming reply is still split');
});
