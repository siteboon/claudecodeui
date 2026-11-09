import assert from 'node:assert/strict';

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, test, vi } from 'vitest';

import type { CodeEditorFile } from '@/shared/types';

/**
 * #1692: a binary file opened from a chat link had no way to be downloaded
 * from the viewer. The viewer now offers the original bytes under the
 * original name, read from the same raw endpoint the Files tab uses.
 */

// The raw endpoint's response body. The download must hand this exact blob to
// the browser: anything rebuilt from text would mangle bytes like 0xff.
const ORIGINAL = new Blob([new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00, 0xff, 0x80, 0x7f])], { type: 'application/zip' });

const readFileBlob = vi.fn(async () => ({
  ok: true,
  status: 200,
  blob: async () => ORIGINAL,
}));

vi.mock('@/shared/api', () => ({
  api: { readFile: vi.fn(), saveFile: vi.fn(), readFileBlob },
  readApiJson: async (response: { json: () => Promise<unknown> }) => response.json(),
}));

vi.mock('@/shared/context/ThemeContext', () => ({
  useTheme: () => ({ isDarkMode: false, toggleDarkMode: () => undefined }),
}));

const { default: CodeEditor } = await import('@/modules/code-editor/CodeEditor');

const file: CodeEditorFile = {
  name: '보고서 résumé.docx',
  path: '/repo/out/보고서 résumé.docx',
  projectId: 'p1',
};

let downloads: { name: string; blob: Blob }[];
const blobsByUrl = new Map<string, Blob>();

beforeEach(() => {
  downloads = [];
  blobsByUrl.clear();
  let nextUrl = 0;
  URL.createObjectURL = vi.fn((blob: Blob) => {
    const url = `blob:test/${nextUrl++}`;
    blobsByUrl.set(url, blob);
    return url;
  }) as typeof URL.createObjectURL;
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    downloads.push({ name: this.download, blob: blobsByUrl.get(this.href)! });
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  readFileBlob.mockClear();
});

const renderViewer = () => render(<CodeEditor file={file} onClose={vi.fn()} />);

// The header icon comes first in the DOM; the labelled button in the body last.
const findDownloadButtons = () => screen.findAllByRole('button', { name: 'Download original file' });
const findBodyDownloadButton = async () => (await findDownloadButtons()).at(-1)!;

test('the binary viewer downloads the original bytes under the original name', async () => {
  renderViewer();

  await act(async () => {
    fireEvent.click(await findBodyDownloadButton());
  });

  await waitFor(() => assert.equal(downloads.length, 1));
  assert.deepEqual(readFileBlob.mock.calls, [['p1', file.path]]);
  assert.equal(downloads[0].name, '보고서 résumé.docx');
  assert.equal(downloads[0].blob, ORIGINAL);
});

test('the header offers the same download', async () => {
  renderViewer();

  const buttons = await findDownloadButtons();
  assert.equal(buttons.length, 2);
  await act(async () => {
    fireEvent.click(buttons[0]);
  });

  await waitFor(() => assert.equal(downloads.length, 1));
  assert.equal(downloads[0].name, file.name);
});

test('a failed download is reported and can be retried', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  readFileBlob.mockResolvedValueOnce({ ok: false, status: 500, blob: async () => new Blob() });
  renderViewer();

  await act(async () => {
    fireEvent.click(await findBodyDownloadButton());
  });

  assert.match((await screen.findByRole('alert')).textContent ?? '', /Could not download/);
  assert.equal(downloads.length, 0);

  await act(async () => {
    fireEvent.click(await findBodyDownloadButton());
  });

  await waitFor(() => assert.equal(downloads.length, 1));
  assert.equal(screen.queryByRole('alert'), null);
});
