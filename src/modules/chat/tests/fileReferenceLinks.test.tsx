import assert from 'node:assert/strict';

import { fireEvent, render, screen } from '@testing-library/react';
import { test, vi } from 'vitest';

/**
 * Regression guard: what a file reference in a chat message hands to the
 * editor. Both suffix helpers are anchored at the end of the string, so a
 * reference picked up from the link text — which, unlike the href, keeps the
 * whitespace around it — used to reach the API with `:12 ` still attached and
 * answer a 404.
 */

const openFileInEditor = vi.fn();
const openDirectory = vi.fn();

vi.mock('@/modules/command-palette', () => ({
  usePaletteOps: () => ({ openFileInEditor, openDirectory }),
}));

const { Markdown } = await import('@/modules/chat/transcript/Markdown');

const clickReference = (markdown: string, linkText: string) => {
  openFileInEditor.mockReset();
  openDirectory.mockReset();
  render(<Markdown>{markdown}</Markdown>);
  fireEvent.click(screen.getByText(linkText));
};

test('a `path:line` reference opens the path without its suffix, at that line', () => {
  clickReference('See [src/foo.ts:130](src/foo.ts:130).', 'src/foo.ts:130');
  assert.deepEqual(openFileInEditor.mock.calls[0], ['src/foo.ts', 130]);
});

test('whitespace around a reference taken from the link text is dropped', () => {
  clickReference('See [`src/foo.ts:12` ]().', 'src/foo.ts:12');
  assert.deepEqual(openFileInEditor.mock.calls[0], ['src/foo.ts', 12]);
});

test('a directory reference goes to the file tree, not the editor', () => {
  clickReference('See [decisions/](decisions/).', 'decisions/');
  assert.equal(openFileInEditor.mock.calls.length, 0);
  assert.deepEqual(openDirectory.mock.calls[0], ['decisions/']);
});

test('a plain file reference opens with no line', () => {
  clickReference('See [src/foo.ts](src/foo.ts).', 'src/foo.ts');
  assert.deepEqual(openFileInEditor.mock.calls[0], ['src/foo.ts', null]);
});

test.each([
  ['raw Unicode', '/workspace/资料/完成记录.md', '/workspace/资料/完成记录.md'],
  ['encoded Unicode', '/workspace/%E8%B5%84%E6%96%99/%E5%AE%8C%E6%88%90%E8%AE%B0%E5%BD%95.md', '/workspace/资料/完成记录.md'],
  ['raw spaces', '</workspace/project notes/report draft.md>', '/workspace/project notes/report draft.md'],
  ['encoded spaces', '/workspace/project%20notes/report%20draft.md', '/workspace/project notes/report draft.md'],
  ['literal percent', '/workspace/100%25-complete.md', '/workspace/100%-complete.md'],
  ['literal escape sequence', '/workspace/literal%2520.md', '/workspace/literal%20.md'],
])('a file href with %s opens the decoded filesystem path', (_name, href, expectedPath) => {
  clickReference(`See [report](${href}).`, 'report');
  assert.deepEqual(openFileInEditor.mock.calls[0], [expectedPath, null]);
  assert.equal(openDirectory.mock.calls.length, 0);
});

test('an encoded file href still reveals its line and column suffix', () => {
  clickReference('See [source](/workspace/%E8%B5%84%E6%96%99/source.ts:12:3).', 'source');
  assert.deepEqual(openFileInEditor.mock.calls[0], ['/workspace/资料/source.ts', 12]);
});

test('an encoded directory href opens the decoded directory in the file tree', () => {
  clickReference('See [notes](/workspace/%E8%B5%84%E6%96%99/project%20notes/).', 'notes');
  assert.equal(openFileInEditor.mock.calls.length, 0);
  assert.deepEqual(openDirectory.mock.calls[0], ['/workspace/资料/project notes/']);
});

test('a raw path taken from link text keeps literal percent sequences', () => {
  clickReference('See [`src/literal%20name.ts:12` ]().', 'src/literal%20name.ts:12');
  assert.deepEqual(openFileInEditor.mock.calls[0], ['src/literal%20name.ts', 12]);
});

test('an invalid UTF-8 escape in a file href does not throw or change the path', () => {
  clickReference('See [report](/workspace/%E0%A4.md).', 'report');
  assert.deepEqual(openFileInEditor.mock.calls[0], ['/workspace/%E0%A4.md', null]);
});

test('an external href keeps normal browser navigation', () => {
  openFileInEditor.mockReset();
  openDirectory.mockReset();
  render(<Markdown>{'See [report](https://example.com/report%20draft.md).'}</Markdown>);
  const link = screen.getByRole('link', { name: 'report' });
  assert.equal(link.getAttribute('href'), 'https://example.com/report%20draft.md');
  assert.equal(link.getAttribute('target'), '_blank');
  assert.equal(fireEvent.click(link), true);
  assert.equal(openFileInEditor.mock.calls.length, 0);
  assert.equal(openDirectory.mock.calls.length, 0);
});
