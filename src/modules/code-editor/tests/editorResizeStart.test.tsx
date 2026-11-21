import assert from 'node:assert/strict';

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import { test, vi } from 'vitest';

import type { Project } from '@/shared/types';

/**
 * Regression guard: in a fill-space tab (Files) the docked editor is laid out
 * with flex until the first drag, so `editorWidth` still held the hook's
 * default. Pressing the resize handle flipped to the fixed-width layout with
 * that stale default, and the editor snapped from the width on screen to 600px
 * before the pointer had moved at all.
 */

const readFile = vi.fn(async () => ({ ok: true, json: async () => ({ content: 'hello' }) }));

vi.mock('@/shared/api', () => ({
  api: { readFile, saveFile: vi.fn() },
  readApiJson: async (response: { json: () => Promise<unknown> }) => response.json(),
}));

vi.mock('@/shared/context/ThemeContext', () => ({
  useTheme: () => ({ isDarkMode: false, toggleDarkMode: () => undefined }),
}));

vi.mock('@uiw/react-codemirror', () => {
  function CodeMirrorStub({ value }: { value: string }) {
    return <textarea data-testid="editor" value={value} readOnly />;
  }

  return { default: CodeMirrorStub };
});

const { default: EditorSidebar } = await import('@/modules/code-editor/EditorSidebar');
const { useEditorSidebar } = await import('@/modules/code-editor/hooks/useEditorSidebar');

// Wide enough that the sidebar stays docked and its ceiling never clamps the
// widths under test.
Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
  configurable: true,
  get: () => 2000,
});

globalThis.ResizeObserver = class {
  observe() {}

  unobserve() {}

  disconnect() {}
} as unknown as typeof ResizeObserver;

const project: Project = { projectId: 'p1', displayName: 'repo', fullPath: '/repo', path: '/repo' };

// The width the flex layout happens to give the editor on screen; deliberately
// far from the hook's 600px default.
const RENDERED_EDITOR_WIDTH = 1234;

/** Wires the hook to the sidebar the way WorkspaceMain does for the Files tab. */
function FilesTabHarness() {
  const sidebar = useEditorSidebar({ selectedProject: project, isMobile: false });
  const { handleFileOpen } = sidebar;

  useEffect(() => {
    handleFileOpen('/repo/a.txt');
  }, [handleFileOpen]);

  return (
    <div>
      <EditorSidebar
        editingFile={sidebar.editingFile}
        isMobile={false}
        editorExpanded={sidebar.editorExpanded}
        editorWidth={sidebar.editorWidth}
        hasManualWidth={sidebar.hasManualWidth}
        resizeHandleRef={sidebar.resizeHandleRef}
        onResizeStart={sidebar.handleResizeStart}
        onCloseEditor={sidebar.handleCloseEditor}
        onToggleEditorExpand={sidebar.handleToggleEditorExpand}
        projectPath="/repo"
        fillSpace
      />
    </div>
  );
}

test('pressing the resize handle keeps the editor at the width it filled', async () => {
  render(<FilesTabHarness />);
  await screen.findByTestId('editor');
  await waitFor(() => assert.ok(readFile.mock.calls.length > 0));

  const handle = screen.getByTitle('Drag to resize');
  const editorPane = handle.nextElementSibling as HTMLElement;
  assert.equal(editorPane.style.width, '', 'the editor fills the space before any drag');

  vi.spyOn(editorPane, 'getBoundingClientRect').mockReturnValue({
    width: RENDERED_EDITOR_WIDTH,
  } as DOMRect);

  fireEvent.mouseDown(handle);

  assert.equal(editorPane.style.width, `${RENDERED_EDITOR_WIDTH}px`);

  fireEvent.mouseUp(document);
});
