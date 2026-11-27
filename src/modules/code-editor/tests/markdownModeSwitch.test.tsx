import assert from 'node:assert/strict';

import { act, fireEvent, render, screen } from '@testing-library/react';
import { test, vi } from 'vitest';

import type { CodeEditorFile, MarkdownViewMode } from '@/shared/types';

/**
 * Markdown files get a Code / Preview / Live switch in the editor header. The
 * header only reports the picked mode; the surface shows the matching view,
 * and Live is the lazily loaded @openmarkdown-dev/editor editing the same
 * buffer as Code.
 */

vi.mock('@uiw/react-codemirror', () => ({
  default: () => <div data-testid="code-editor" />,
}));

// Records what the Live editor hands the package, and lets a test play the
// part of a user edit through the host's onChange callback.
const liveEditor = vi.hoisted(() => ({
  mounted: 0,
  options: null as null | { doc?: string; host?: { onChange?: (doc: string, isUserEdit: boolean) => void } },
}));

vi.mock('@openmarkdown-dev/editor', () => ({
  openMarkdownText: (source: string) => ({ text: source, source }),
  saveMarkdownText: (doc: string) => doc,
  createEditorState: (options: typeof liveEditor.options) => options,
  mountEditor: (parent: HTMLElement, state: typeof liveEditor.options) => {
    liveEditor.mounted += 1;
    liveEditor.options = state;
    const dom = document.createElement('div');
    dom.dataset.testid = 'live-editor';
    parent.appendChild(dom);
    let doc = state?.doc ?? '';
    return {
      view: { dom },
      getDoc: () => doc,
      setDoc: (next: string) => {
        doc = next;
      },
      setEnvironment: () => undefined,
      destroy: () => dom.remove(),
    };
  },
}));

const { default: CodeEditorHeader } = await import('@/modules/code-editor/CodeEditorHeader');
const { default: CodeEditorSurface } = await import('@/modules/code-editor/CodeEditorSurface');

const markdownFile: CodeEditorFile = { name: 'notes.md', path: '/repo/notes.md', projectId: 'p1' };

const labels = {
  showingChanges: 'Showing changes',
  copyPath: 'Copy file path',
  pathCopied: 'File path copied',
  editMarkdown: 'Edit markdown',
  previewMarkdown: 'Preview markdown',
  liveMarkdown: 'Live preview editing',
  previewHtml: 'Open HTML preview',
  settings: 'Settings',
  download: 'Download',
  save: 'Save',
  saving: 'Saving',
  saved: 'Saved',
  fullscreen: 'Fullscreen',
  exitFullscreen: 'Exit fullscreen',
  close: 'Close',
  unsavedChanges: 'Unsaved changes',
};

const renderHeader = (
  isMarkdownFile: boolean,
  markdownMode: MarkdownViewMode,
  onMarkdownModeChange: (mode: MarkdownViewMode) => void = () => undefined,
) =>
  render(
    <CodeEditorHeader
      file={markdownFile}
      isSidebar
      isFullscreen={false}
      isMarkdownFile={isMarkdownFile}
      isHtmlPreviewFile={false}
      markdownMode={markdownMode}
      saving={false}
      saveSuccess={false}
      hasUnsavedChanges={false}
      onMarkdownModeChange={onMarkdownModeChange}
      onOpenHtmlPreview={() => undefined}
      onOpenSettings={() => undefined}
      onDownload={() => undefined}
      onSave={() => undefined}
      onToggleFullscreen={() => undefined}
      onClose={() => undefined}
      labels={labels}
    />,
  );

const renderSurface = (
  markdownMode: MarkdownViewMode,
  { isMarkdownFile = true, content = '# Notes\n', onChange = () => undefined }: {
    isMarkdownFile?: boolean;
    content?: string;
    onChange?: (value: string) => void;
  } = {},
) =>
  render(
    <CodeEditorSurface
      content={content}
      onChange={onChange}
      markdownMode={markdownMode}
      isMarkdownFile={isMarkdownFile}
      isDarkMode={false}
      fontSize={14}
      showLineNumbers
      extensions={[]}
    />,
  );

test('picking a mode in the header reports it, and the active one is pressed', () => {
  const onMarkdownModeChange = vi.fn();
  renderHeader(true, 'preview', onMarkdownModeChange);

  assert.equal(screen.getByRole('button', { name: labels.previewMarkdown }).getAttribute('aria-pressed'), 'true');
  assert.equal(screen.getByRole('button', { name: labels.editMarkdown }).getAttribute('aria-pressed'), 'false');

  fireEvent.click(screen.getByRole('button', { name: labels.liveMarkdown }));
  fireEvent.click(screen.getByRole('button', { name: labels.editMarkdown }));
  assert.deepEqual(onMarkdownModeChange.mock.calls, [['live'], ['code']]);
});

test('the mode switch, Live included, is only offered for Markdown files', () => {
  renderHeader(false, 'code');
  assert.equal(screen.queryByRole('button', { name: labels.liveMarkdown }), null);
  assert.equal(screen.queryByRole('button', { name: labels.previewMarkdown }), null);
});

test('Live mode loads the Live editor in place of the code view', async () => {
  liveEditor.mounted = 0;
  renderSurface('live', { content: '# Notes\n' });

  // The Live editor is a lazy chunk, so it lands after the first render.
  await screen.findByTestId('live-editor');
  assert.equal(screen.queryByTestId('code-editor'), null);
  assert.equal(liveEditor.mounted, 1);
  assert.equal(liveEditor.options?.doc, '# Notes\n');
});

test('a Live edit goes back to the shared buffer through onChange', async () => {
  const onChange = vi.fn();
  renderSurface('live', { onChange });
  await screen.findByTestId('live-editor');

  act(() => {
    liveEditor.options?.host?.onChange?.('# Notes\n\nmore\n', true);
    // Programmatic changes (a reload from disk) are not edits to report.
    liveEditor.options?.host?.onChange?.('# Other\n', false);
  });
  assert.deepEqual(onChange.mock.calls, [['# Notes\n\nmore\n']]);
});

test('Code and Preview modes do not load the Live editor', () => {
  liveEditor.mounted = 0;
  renderSurface('code');
  assert.ok(screen.getByTestId('code-editor'));
  renderSurface('preview', { content: 'Rendered text' });
  assert.ok(screen.getByText('Rendered text'));
  assert.equal(liveEditor.mounted, 0);
});

test('a non-Markdown file stays in the code view even when the mode says Live', () => {
  liveEditor.mounted = 0;
  renderSurface('live', { isMarkdownFile: false });
  assert.ok(screen.getByTestId('code-editor'));
  assert.equal(liveEditor.mounted, 0);
});
