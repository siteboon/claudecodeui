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

for (const [label, formula] of [
  ['conditional probability', String.raw`P(A|B)`],
  ['absolute values', String.raw`\left|x\right|`],
  ['TeX norm delimiters', String.raw`\|x\|`],
  ['array column separators', String.raw`\begin{array}{c|c}a&b\end{array}`],
]) {
  test(`keeps ${label} inside one table cell`, () => {
    const html = renderMarkdown(`| Name | Formula | Note |\n| --- | --- | --- |\n| value | \\(${formula}\\) | keep this |`);

    assert.equal((html.match(/<td(?:\s|>)/g) ?? []).length, 3);
    assert.match(html, /class="katex"/);
    assert.doesNotMatch(html, /katex-error|[\uE000-\uF8FF]/);
    assert.ok(html.includes(`${formula.replace(/&/g, '&amp;')}</annotation>`));
    assert.match(html, /<td>keep this<\/td>/);
  });
}

test('protects formulas in table headers and in adjacent cells', () => {
  const html = renderMarkdown(String.raw`| \(P(A|B)\) | \(P(B|A)\) |
| --- | --- |
| \(|x|\) | \(|y|\) |`);

  assert.equal((html.match(/<th(?:\s|>)/g) ?? []).length, 2);
  assert.equal((html.match(/<td(?:\s|>)/g) ?? []).length, 2);
  assert.equal((html.match(/class="katex"/g) ?? []).length, 4);
  assert.doesNotMatch(html, /katex-error|[\uE000-\uF8FF]/);
});

test('keeps closed but invalid TeX in its own cell without hiding later cells', () => {
  const html = renderMarkdown(String.raw`| Formula | Note |
| --- | --- |
| \(\frac{a|b}{\) | keep this |`);

  assert.match(html, /katex-error/);
  assert.match(html, /<td>keep this<\/td>/);
  assert.equal((html.match(/<td(?:\s|>)/g) ?? []).length, 2);
  assert.doesNotMatch(html, /<pre>|[\uE000-\uF8FF]/);
});

test('preserves a whole unfinished table as literal text rather than dropping extra cells', () => {
  const content = String.raw`| Name | Formula | Note |
| --- | --- | --- |
| value | \(P(A|B) | keep this |
| following row | unchanged | also keep this |`;
  const html = renderMarkdown(content);

  assert.match(html, /<pre><code>/);
  assert.doesNotMatch(html, /<table>|class="katex"|[\uE000-\uF8FF]/);
  assert.ok(html.includes(content));
});

test('preserves incomplete math in a table header before GFM can recognize the table', () => {
  const content = String.raw`| \(P(A|B) | Note |
| --- | --- |
| value | keep this |`;
  const html = renderMarkdown(content);

  assert.match(html, /<pre><code>/);
  assert.ok(html.includes(content));
  assert.doesNotMatch(html, /<table>|class="katex"/);
});

test('preserves incomplete math in a body row without explicit cell dividers', () => {
  const content = '| Formula | Note |\n| --- | --- |\n\\(not finished';
  const html = renderMarkdown(content);

  assert.match(html, /<pre><code>/);
  assert.ok(html.includes(content));
  assert.doesNotMatch(html, /<table>|class="katex"/);
});

test('does not borrow a closing math delimiter from a later row or paragraph', () => {
  const content = String.raw`| Formula | Note |
| --- | --- |
| \(P(A|B) | first |
| \) | second |

After the table: \(x + 1\).`;
  const html = renderMarkdown(content);

  assert.match(html, /<pre><code>/);
  assert.ok(html.includes(String.raw`| \) | second |`));
  assert.match(html, /After the table:/);
  assert.equal((html.match(/class="katex"/g) ?? []).length, 1);
});

test('restores normal table rendering only after streamed math has closed', () => {
  const prefix = '| Name | Formula | Note |\n| --- | --- | --- |\n| value | ';
  const formula = String.raw`\(P(A|B)\)`;
  for (let end = 2; end < formula.length; end += 1) {
    const pending = prefix + formula.slice(0, end);
    const html = renderMarkdown(pending);
    assert.match(html, /<pre><code>/, `unfinished prefix ${end}`);
    assert.ok(html.includes(pending), `unfinished prefix ${end} lost content`);
    assert.doesNotMatch(html, /class="katex"/);
  }
  const complete = renderMarkdown(`${prefix}${formula} | keep this |`);
  assert.match(complete, /<table>/);
  assert.match(complete, /class="katex"/);
  assert.match(complete, /<td>keep this<\/td>/);
  assert.doesNotMatch(complete, /<pre>|[\uE000-\uF8FF]/);
});

test('does not change formula-looking text in inline code or escaped delimiters', () => {
  const html = renderMarkdown('| Literal | Note |\n| --- | --- |\n| `\\(A\\|B\\)` | keep this |\n| \\\\(A\\|B) | also keep this |');

  assert.doesNotMatch(html, /class="katex"|<pre>|[\uE000-\uF8FF]/);
  assert.ok(html.includes(String.raw`<code>\(A|B\)</code>`));
  assert.match(html, /also keep this/);
});

test('leaves fenced and indented code untouched and resumes protection after a fence', () => {
  const table = String.raw`| Formula | Note |
| --- | --- |
| \(A|B\) | keep this |`;
  const html = renderMarkdown(`\`\`\`text\n${table}\n\`\`\`\n\n    \\(x|y\\)\n\n${table}`);

  assert.ok(html.includes(table));
  assert.equal((html.match(/<table>/g) ?? []).length, 1);
  assert.equal((html.match(/class="katex"/g) ?? []).length, 1);
  assert.doesNotMatch(html, /[\uE000-\uF8FF]/);
});

test('protects tables after a code fence that ends with its blockquote container', () => {
  const html = renderMarkdown('> ```text\n> \\(x|y\\)\n\n| Formula | Note |\n| --- | --- |\n| \\(A|B\\) | keep this |');

  assert.ok(html.includes(String.raw`\(x|y\)`));
  assert.equal((html.match(/class="katex"/g) ?? []).length, 1);
  assert.match(html, /<td>keep this<\/td>/);
  assert.doesNotMatch(html, /[\uE000-\uF8FF]/);
});

test('handles escaped backticks without treating the middle of a run as a new run', () => {
  const content = '| Literal | Formula |\n| --- | --- |\n| \\``` literal | \\(P(A|B)\\) |';

  assert.doesNotThrow(() => renderMarkdown(content));
});

test('keeps user-authored private-use characters distinct from temporary pipe markers', () => {
  const html = renderMarkdown('\uE000\n\n| Formula | Note |\n| --- | --- |\n| \\(A|B\\) | keep this |');

  assert.ok(html.includes('\uE000'));
  assert.doesNotMatch(html, /\uE001/);
  assert.match(html, /A\|B<\/annotation>/);
  assert.match(html, /<td>keep this<\/td>/);
});

test('preserves table math with CRLF line endings and non-ASCII text before it', () => {
  const html = renderMarkdown('中文 😀\r\n\r\n| 公式 | 备注 |\r\n| --- | --- |\r\n| \\(P(A|B)\\) | 保留 |');

  assert.match(html, /class="katex"/);
  assert.match(html, /P\(A\|B\)<\/annotation>/);
  assert.match(html, /<td>保留<\/td>/);
});
