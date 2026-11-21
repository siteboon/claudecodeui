import assert from 'node:assert/strict';

import { fireEvent, render } from '@testing-library/react';
import { beforeEach, test, vi } from 'vitest';

import { Markdown } from '@/modules/chat/transcript/Markdown';

const { openFileInEditor, openDirectory } = vi.hoisted(() => ({
  openFileInEditor: vi.fn(),
  openDirectory: vi.fn(),
}));

vi.mock('@/modules/command-palette', () => ({
  usePaletteOps: () => ({ openFileInEditor, openDirectory }),
}));

beforeEach(() => {
  openFileInEditor.mockClear();
  openDirectory.mockClear();
});

// Exercise the real Markdown parser: it percent-encodes Unicode and spaces
// before handing href to the app's link renderer.
test.each([
  ['/workspace/자료/경력-원장.md', '/workspace/자료/경력-원장.md', null],
  ['/workspace/资料/完成记录.md', '/workspace/资料/完成记录.md', null],
  ['/workspace/日本語/メモ.md', '/workspace/日本語/メモ.md', null],
  ['/workspace/café/résumé.md', '/workspace/café/résumé.md', null],
  ['/workspace/%EC%9D%B4%EB%A0%A5.md:42:3', '/workspace/이력.md', 42],
  ['/workspace/My Report/진행 100%.md', '/workspace/My Report/진행 100%.md', null],
  ['/workspace/100%-complete%20draft.md', '/workspace/100%-complete draft.md', null],
  ['/workspace/literal%2520.md', '/workspace/literal%20.md', null],
  ['/workspace/name%23part%3F%2B.md', '/workspace/name#part?+.md', null],
  ['/workspace/notes.md%3A12', '/workspace/notes.md:12', null],
  ['notes.md%3A12', 'notes.md:12', null],
  ['./notes.md%3A12:9', './notes.md:12', 9],
  ['notes%2Emd', 'notes.md', null],
  ['src/%ED%95%9C%EA%B8%80.ts:9', 'src/한글.ts', 9],
  ['/workspace/자료/100%complete.md', '/workspace/자료/100%complete.md', null],
  ['/workspace/자료/%draft%2520.md', '/workspace/자료/%draft%20.md', null],
  ['/workspace/자료/bad%E0%A4%20draft.md', '/workspace/자료/bad%E0%A4 draft.md', null],
  ['/workspace/%FF%EC%9E%90%EB%A3%8C.md', '/workspace/%FF자료.md', null],
  ['/workspace/%ED%A0%80%20notes.md', '/workspace/%ED%A0%80 notes.md', null],
  ['/workspace/자료/%F0%9F%93%9D.md', '/workspace/자료/📝.md', null],
  ['/workspace/bad%E0%A4.md', '/workspace/bad%E0%A4.md', null],
])('opens the local href %s as an exact filesystem path', (href, expected, line) => {
  const { getByRole } = render(<Markdown>{`[원장](<${href}>)`}</Markdown>);
  fireEvent.click(getByRole('link'));
  assert.deepEqual(openFileInEditor.mock.calls, [[expected, line]]);
  assert.equal(openDirectory.mock.calls.length, 0);
});

test.each([
  ['/workspace/이력원장/', '/workspace/이력원장/'],
  ['/workspace/자료/100%complete/', '/workspace/자료/100%complete/'],
])('decodes the directory href %s before opening the file tree', (href, expected) => {
  const { getByRole } = render(<Markdown>{`[폴더](${href})`}</Markdown>);
  fireEvent.click(getByRole('link'));
  assert.deepEqual(openDirectory.mock.calls, [[expected]]);
  assert.equal(openFileInEditor.mock.calls.length, 0);
});

test('link-text fallback is literal filesystem text, not an encoded URL', () => {
  const { getByRole } = render(<Markdown>{'[src/literal%20.ts:7]()'}</Markdown>);
  fireEvent.click(getByRole('link'));
  assert.deepEqual(openFileInEditor.mock.calls, [['src/literal%20.ts', 7]]);
});

test('external URLs keep their browser navigation and encoding', () => {
  const href = 'https://example.com/%EC%9D%B4%EB%A0%A5.md';
  const { getByRole } = render(<Markdown>{`[원장](${href})`}</Markdown>);
  const link = getByRole('link');
  assert.equal(link.getAttribute('href'), href);
  assert.equal(link.getAttribute('target'), '_blank');
  const click = new MouseEvent('click', { bubbles: true, cancelable: true });
  assert.equal(fireEvent(link, click), true);
  assert.equal(openFileInEditor.mock.calls.length, 0);
  assert.equal(openDirectory.mock.calls.length, 0);
});
