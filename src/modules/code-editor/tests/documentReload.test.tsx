import assert from 'node:assert/strict';

import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { beforeEach, test, vi } from 'vitest';

import type { CodeEditorFile } from '@/shared/types';

/**
 * Regression guard: the pane has to show what is on disk now, not what was
 * there the first time the file was opened. The document was read once per file
 * identity, so clicking the same reference again — the gesture people reach for
 * — changed nothing and left an old buffer on screen; only closing the file and
 * opening it again helped.
 *
 * The other half is that a reload must never be the thing that loses someone's
 * work: with unsaved changes in the buffer it refuses and says so, and the way
 * through is taken by hand.
 */

const { disk, readFile, saveFile } = vi.hoisted(() => ({
  // What the file holds on disk right now, which the tests move under the editor.
  disk: { content: 'first version' },
  readFile: vi.fn(),
  saveFile: vi.fn(),
}));

// Partial mock: the hook parses reads with the real readApiJson.
vi.mock('@/shared/api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  api: { readFile, saveFile },
}));

const { useCodeEditorDocument } = await import('@/modules/code-editor/hooks/useCodeEditorDocument');
const { default: CodeEditorHeader } = await import('@/modules/code-editor/CodeEditorHeader');

const jsonResponse = (body: unknown) => new Response(JSON.stringify(body), {
  status: 200,
  headers: { 'Content-Type': 'application/json' },
});

// One open of the same file. The editor sidebar builds a new object per open,
// which is how a second click on the same reference is told apart from a
// re-render.
const openSameFile = (): CodeEditorFile => ({
  name: 'app.ts',
  path: 'src/app.ts',
  projectId: 'project-1',
});

const renderDocument = () => renderHook(
  ({ file }: { file: CodeEditorFile }) => useCodeEditorDocument({ file }),
  { initialProps: { file: openSameFile() } },
);

beforeEach(() => {
  // `restoreMocks` in the vitest config does not clear the call history of these
  // module-level mocks, and some tests count calls.
  readFile.mockClear();
  saveFile.mockClear();
  disk.content = 'first version';
  readFile.mockImplementation(async () => jsonResponse({ content: disk.content }));
  saveFile.mockImplementation(async (_projectId: string, _path: string, content: string) => {
    disk.content = content;
    return jsonResponse({ success: true });
  });
});

test('opening the same file again reads it from disk again', async () => {
  const { result, rerender } = renderDocument();
  await waitFor(() => assert.equal(result.current.content, 'first version'));

  disk.content = 'second version';
  rerender({ file: openSameFile() });

  await waitFor(() => assert.equal(result.current.content, 'second version'));
});

test('the reload action reads the file again', async () => {
  const { result } = renderDocument();
  await waitFor(() => assert.equal(result.current.content, 'first version'));

  disk.content = 'second version';
  act(() => result.current.reload());

  await waitFor(() => assert.equal(result.current.content, 'second version'));
});

test('a reload with unsaved changes keeps the buffer and says it did not reload', async () => {
  const { result, rerender } = renderDocument();
  await waitFor(() => assert.equal(result.current.content, 'first version'));

  act(() => result.current.setContent('work in progress'));
  disk.content = 'second version';
  rerender({ file: openSameFile() });

  await waitFor(() => assert.equal(result.current.unsavedChangesBlockedReload, true));
  assert.equal(result.current.content, 'work in progress');
  assert.equal(readFile.mock.calls.length, 1);
});

test('discarding the unsaved changes on purpose reloads the file', async () => {
  const { result, rerender } = renderDocument();
  await waitFor(() => assert.equal(result.current.content, 'first version'));

  act(() => result.current.setContent('work in progress'));
  disk.content = 'second version';
  rerender({ file: openSameFile() });
  await waitFor(() => assert.equal(result.current.unsavedChangesBlockedReload, true));

  act(() => result.current.reloadDiscardingChanges());

  await waitFor(() => assert.equal(result.current.content, 'second version'));
  assert.equal(result.current.unsavedChangesBlockedReload, false);
});

test('typing again answers the notice', async () => {
  const { result, rerender } = renderDocument();
  await waitFor(() => assert.equal(result.current.content, 'first version'));

  act(() => result.current.setContent('work in progress'));
  rerender({ file: openSameFile() });
  await waitFor(() => assert.equal(result.current.unsavedChangesBlockedReload, true));

  act(() => result.current.setContent('work in progress, still'));

  assert.equal(result.current.unsavedChangesBlockedReload, false);
});

test('saving leaves the buffer clean, so the next open reloads it', async () => {
  const { result, rerender } = renderDocument();
  await waitFor(() => assert.equal(result.current.content, 'first version'));

  act(() => result.current.setContent('my edit'));
  await act(async () => {
    await result.current.handleSave();
  });

  disk.content = 'someone else edit';
  rerender({ file: openSameFile() });

  await waitFor(() => assert.equal(result.current.content, 'someone else edit'));
});

test('a superseded read does not overwrite the file opened after it', async () => {
  // Each read waits until the test resolves it, so the older one can be made to
  // answer last.
  const pendingReads = new Map<string, (content: string) => void>();
  readFile.mockImplementation((_projectId: string, path: string) => new Promise<Response>((resolve) => {
    pendingReads.set(path, (content) => resolve(jsonResponse({ content })));
  }));

  const { result, rerender } = renderDocument();
  await waitFor(() => assert.ok(pendingReads.has('src/app.ts')));

  rerender({ file: { name: 'other.ts', path: 'src/other.ts', projectId: 'project-1' } });
  await waitFor(() => assert.ok(pendingReads.has('src/other.ts')));

  await act(async () => pendingReads.get('src/other.ts')?.('other content'));
  await waitFor(() => assert.equal(result.current.content, 'other content'));
  assert.equal(result.current.loading, false);

  await act(async () => pendingReads.get('src/app.ts')?.('stale app content'));

  assert.equal(result.current.content, 'other content');
  assert.equal(result.current.loading, false);

  await act(async () => {
    await result.current.handleSave();
  });
  assert.deepEqual(saveFile.mock.calls[0], ['project-1', 'src/other.ts', 'other content']);
});

test('the header offers the reload', () => {
  const onReload = vi.fn();

  render(
    <CodeEditorHeader
      file={openSameFile()}
      isSidebar
      isFullscreen={false}
      isMarkdownFile={false}
      isHtmlPreviewFile={false}
      markdownPreview={false}
      saving={false}
      saveSuccess={false}
      onToggleMarkdownPreview={() => undefined}
      onOpenHtmlPreview={() => undefined}
      onOpenSettings={() => undefined}
      onReload={onReload}
      onDownload={() => undefined}
      onSave={() => undefined}
      onToggleFullscreen={() => undefined}
      onClose={() => undefined}
      labels={{
        showingChanges: 'Showing changes',
        copyPath: 'Copy file path',
        pathCopied: 'File path copied',
        editMarkdown: 'Edit markdown',
        previewMarkdown: 'Preview markdown',
        previewHtml: 'Open HTML preview in new tab',
        settings: 'Editor Settings',
        reload: 'Reload from disk',
        download: 'Download file',
        save: 'Save',
        saving: 'Saving...',
        saved: 'Saved!',
        fullscreen: 'Fullscreen',
        exitFullscreen: 'Exit fullscreen',
        close: 'Close',
      }}
    />,
  );

  fireEvent.click(screen.getByLabelText('Reload from disk'));

  assert.equal(onReload.mock.calls.length, 1);
});
