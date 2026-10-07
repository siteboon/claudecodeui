import assert from 'node:assert/strict';

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { test, vi } from 'vitest';

import type { CodeEditorFile } from '@/shared/types';

/**
 * Regression guard for #870: `EditorSidebar` used to return a different root
 * element for the floating layout (mobile or popped out) than for the docked
 * one, so every switch unmounted `CodeEditor`, re-read the file from disk and
 * threw the unsaved buffer away without asking — reachable from the editor's
 * own pop-out button, from a container too narrow to split, and from the mobile
 * breakpoint. There is one editor element in one tree position now; only the
 * wrappers around it change.
 */

const readFile = vi.fn(async () => ({ ok: true, json: async () => ({ content: 'hello' }) }));
const saveFile = vi.fn(async () => ({ ok: true, json: async () => ({ success: true }) }));

vi.mock('@/shared/api', () => ({
  api: { readFile, saveFile },
  readApiJson: async (response: { json: () => Promise<unknown> }) => response.json(),
}));

vi.mock('@/shared/context/ThemeContext', () => ({
  useTheme: () => ({ isDarkMode: false, toggleDarkMode: () => undefined }),
}));

vi.mock('@uiw/react-codemirror', () => {
  function CodeMirrorStub({ value, onChange }: { value: string; onChange?: (value: string) => void }) {
    return (
      <textarea
        data-testid="editor"
        value={value}
        onChange={(event) => onChange?.(event.target.value)}
      />
    );
  }

  return { default: CodeMirrorStub };
});

type ToolbarPanelParams = {
  isSidebar: boolean;
  isExpanded: boolean;
  onPopOut: (() => void) | null;
  onToggleExpand: (() => void) | null;
};

// The pop-out button lives in a CodeMirror panel, which the stubbed editor does
// not build. Standing in for the panel keeps hold of the exact arguments the
// real `.cm-popout-btn` was rendered from and of the callback its click handler
// invokes, so the test can press it and can check when it is offered at all.
const toolbarPanels: ToolbarPanelParams[] = [];

vi.mock('@/modules/code-editor/utils/editorToolbarPanel', () => ({
  createEditorToolbarPanelExtension: (params: ToolbarPanelParams) => {
    toolbarPanels.push(params);
    return [];
  },
}));

const { default: EditorSidebar } = await import('@/modules/code-editor/EditorSidebar');

const file: CodeEditorFile = { name: 'a.txt', path: '/repo/a.txt', projectId: 'p1' };

// The width the sidebar's ResizeObserver/resize handler reads off the parent.
let containerWidth = 1400;

Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
  configurable: true,
  get: () => containerWidth,
});

globalThis.ResizeObserver = class {
  observe() {}

  unobserve() {}

  disconnect() {}
} as unknown as typeof ResizeObserver;

const onUnsavedChangesChange = vi.fn();

const sidebar = (isMobile: boolean) => (
  <div>
    <EditorSidebar
      editingFile={file}
      isMobile={isMobile}
      editorExpanded={false}
      editorWidth={600}
      hasManualWidth={false}
      resizeHandleRef={{ current: null }}
      onResizeStart={() => undefined}
      onCloseEditor={() => undefined}
      onToggleEditorExpand={() => undefined}
      onUnsavedChangesChange={onUnsavedChangesChange}
      projectPath="/repo"
    />
  </div>
);

const renderSidebar = async (isMobile = false) => {
  containerWidth = 1400;
  toolbarPanels.length = 0;
  const view = render(sidebar(isMobile));
  const editor = await screen.findByTestId<HTMLTextAreaElement>('editor');
  await waitFor(() => assert.equal(editor.value, 'hello'));
  return { ...view, editor };
};

const typeInto = (editor: HTMLTextAreaElement, value: string) => {
  fireEvent.change(editor, { target: { value } });
};

/** The docked layout is the only one with a drag handle beside the editor. */
const isDocked = () => screen.queryByTitle('Drag to resize') !== null;

/** The floating layout is the modal one: a full-viewport overlay. */
const isFloating = (container: HTMLElement) => container.querySelector('.fixed.inset-0') !== null;

// Everything a layout switch must not destroy, in one assertion.
const assertBufferSurvived = () => {
  assert.equal(screen.getByTestId<HTMLTextAreaElement>('editor').value, 'hello edited');
  assert.ok(screen.getByLabelText('Unsaved changes'), 'the dirty dot is still shown');
  assert.equal(readFile.mock.calls.length, 1, 'the file was not re-read from disk');
  assert.equal(onUnsavedChangesChange.mock.calls.at(-1)?.[0], true);
};

test('the pop-out button keeps the unsaved buffer and the dirty dot', async () => {
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  const { container, editor } = await renderSidebar();
  assert.ok(isDocked());

  typeInto(editor, 'hello edited');

  // Exactly what clicking `.cm-popout-btn` does.
  const popOut = toolbarPanels.at(-1)?.onPopOut;
  assert.ok(popOut, 'the docked toolbar offers a pop-out button');
  act(() => popOut());

  await waitFor(() => assert.ok(isFloating(container)));
  assert.equal(isDocked(), false);
  assertBufferSurvived();
  // The buffer was kept, so nothing had to be confirmed away.
  assert.equal(confirm.mock.calls.length, 0);
  // The modal drops the sidebar chrome, as it always did: no pop-out or expand
  // button inside it, and a fullscreen toggle instead.
  assert.equal(toolbarPanels.at(-1)?.isSidebar, false);
  assert.equal(toolbarPanels.at(-1)?.onPopOut, null);
  assert.equal(toolbarPanels.at(-1)?.onToggleExpand, null);
  assert.ok(screen.getByTitle('actions.fullscreen'));
  assert.ok(screen.getByTitle('actions.close'));
});

test('a container too narrow to split pops the editor out without losing edits', async () => {
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  const { container, editor } = await renderSidebar();

  typeInto(editor, 'hello edited');

  // Below MIN_LEFT_CONTENT_WIDTH + MIN_EDITOR_WIDTH the sidebar pops out by itself.
  containerWidth = 300;
  act(() => { window.dispatchEvent(new Event('resize')); });

  await waitFor(() => assert.ok(isFloating(container)));
  assertBufferSurvived();
  assert.equal(confirm.mock.calls.length, 0);

  // Widening again leaves the editor floating (it always has), and the text is
  // still there either way.
  containerWidth = 1400;
  act(() => { window.dispatchEvent(new Event('resize')); });
  assertBufferSurvived();
});

test('crossing the mobile breakpoint in both directions keeps the unsaved buffer', async () => {
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  const { container, editor, rerender } = await renderSidebar();

  typeInto(editor, 'hello edited');

  // Window narrowed past 768px: the workspace reports mobile.
  rerender(sidebar(true));
  await waitFor(() => assert.ok(isFloating(container)));
  assert.equal(isDocked(), false);
  assertBufferSurvived();

  // ...and widened back to desktop, which docks the editor again.
  rerender(sidebar(false));
  await waitFor(() => assert.ok(isDocked()));
  assert.equal(isFloating(container), false);
  assertBufferSurvived();
  assert.equal(toolbarPanels.at(-1)?.isSidebar, true);
  assert.ok(toolbarPanels.at(-1)?.onPopOut);

  assert.equal(confirm.mock.calls.length, 0);
});

test('an editor opened on mobile is floating from the start', async () => {
  const { container } = await renderSidebar(true);

  assert.ok(isFloating(container));
  assert.equal(isDocked(), false);
  assert.equal(toolbarPanels.at(-1)?.isSidebar, false);
});
