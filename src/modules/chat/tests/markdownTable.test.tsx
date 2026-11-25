import assert from 'node:assert/strict';

import { fireEvent, render } from '@testing-library/react';
import { test, vi } from 'vitest';

import { Markdown } from '@/modules/chat/transcript/Markdown';
import StreamingMarkdown from '@/modules/chat/transcript/StreamingMarkdown';

vi.mock('@/modules/command-palette', () => ({
  usePaletteOps: () => ({ openFileInEditor: vi.fn(), openDirectory: vi.fn() }),
}));

const table = (rows: string) => `| Name | 说明 |\n| :--- | ---: |\n${rows}`;

// Exercise the shared renderer through both callers, including a settled prefix.
for (const streaming of [false, true]) {
  const renderMarkdown = (content: string) => render(streaming
    ? <StreamingMarkdown content={`Intro.\n\n${content}`} isStreaming />
    : <Markdown>{content}</Markdown>);
  const mode = streaming ? 'streaming' : 'ordinary';

  test(`${mode}: renders mixed-language cells and preserves all column alignments`, () => {
    const name = 'AnExtremelyLongUnbrokenEnglishComponentName';
    const { container } = renderMarkdown([
      '| Name | 中文说明 | Status |',
      '| :--- | :---: | ---: |',
      `| ${name} | 这是需要保持可读的中文说明 | ready |`,
    ].join('\n'));
    const result = container.querySelector('table');
    assert.ok(result);
    assert.equal(result.querySelector('td')?.textContent, name);
    assert.equal(result.rows[1].cells[1].textContent, '这是需要保持可读的中文说明');
    for (const row of Array.from(result.rows)) {
      assert.deepEqual(Array.from(row.cells, (cell) => cell.style.textAlign), ['left', 'center', 'right']);
    }
  });

  test(`${mode}: promotes only standalone attribute-free br nodes inside table cells`, () => {
    const { container } = renderMarkdown('Outside<br>literal.\n\n' + [
      '| Head<br/>title | 说明 |',
      '| --- | --- |',
      '| one<br>two<BR />three | **first<br />second** |',
    ].join('\n'));
    const result = container.querySelector('table');
    assert.ok(result);
    assert.equal(result.querySelectorAll('br').length, 4);
    assert.equal(result.querySelector('strong br')?.tagName, 'BR');
    assert.ok(container.textContent?.includes('Outside<br>literal.'));
    assert.ok(!result.textContent?.includes('<br'));
  });

  test(`${mode}: keeps inline code, escaped tags, entities and fenced code literal`, () => {
    const { container } = renderMarkdown(table([
      '| code | `<br>` and `<br/>` |',
      '| escaped | \\<br> |',
      '| entity | &lt;br/&gt; |',
    ].join('\n')) + '\n\n```html\n<br>\n```');
    assert.equal(container.querySelectorAll('br').length, 0);
    assert.deepEqual(Array.from(container.querySelectorAll('td code'), (code) => code.textContent), ['<br>', '<br/>']);
    assert.equal(container.querySelectorAll('tbody tr')[1].lastElementChild?.textContent, '<br>');
    assert.equal(container.querySelectorAll('tbody tr')[2].lastElementChild?.textContent, '<br/>');
    const codeNodes = container.querySelectorAll('code');
    assert.equal(codeNodes[codeNodes.length - 1].textContent?.trim(), '<br>');
  });

  test(`${mode}: keeps attributed breaks and other raw HTML inert`, () => {
    const html = '<br title="x"><br onclick="alert(1)"><img src=x onerror="alert(1)"><script>alert(1)</script><iframe src="https://example.com"></iframe>';
    const { container } = renderMarkdown(table(`| HTML | ${html} |`));
    assert.equal(container.querySelector('br, img, script, iframe, [onclick], [onerror]'), null);
    assert.ok(container.querySelector('td:last-child')?.textContent?.includes(html));
  });

  test(`${mode}: keeps external table links navigable with their original URL`, () => {
    const href = 'https://example.com/AnExtremelyLongUnbrokenEnglishPath?language=zh';
    const { getByRole } = renderMarkdown(table(`| link | [${href}](${href}) |`));
    const link = getByRole('link');
    assert.equal(link.getAttribute('href'), href);
    assert.equal(link.getAttribute('target'), '_blank');
    assert.equal(link.getAttribute('rel'), 'noopener noreferrer');
    assert.equal(fireEvent(link, new MouseEvent('click', { bubbles: true, cancelable: true })), true);
  });
}
