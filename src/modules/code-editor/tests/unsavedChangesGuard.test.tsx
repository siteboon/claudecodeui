import assert from 'node:assert/strict';

import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { test, vi } from 'vitest';

import type { CodeEditorFile, Project } from '@/shared/types';

/**
 * Regression guard for #870: the editor closed on Escape, the header X, or a
 * click on another file and silently threw away whatever had been typed. A
 * dirty buffer now asks first; a clean one — including right after a save —
 * still closes without a word.
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

// A textarea is enough of CodeMirror here: the guard only cares that typing
// reaches `onChange`.
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

const { default: CodeEditor } = await import('@/modules/code-editor/CodeEditor');
const { useEditorSidebar } = await import('@/modules/code-editor/hooks/useEditorSidebar');

const file: CodeEditorFile = { name: 'a.txt', path: '/repo/a.txt', projectId: 'p1' };
const otherFile: CodeEditorFile = { name: 'b.txt', path: '/repo/b.txt', projectId: 'p1' };

const renderEditor = async (onUnsavedChangesChange?: (dirty: boolean) => void) => {
  const onClose = vi.fn();
  render(<CodeEditor file={file} onClose={onClose} onUnsavedChangesChange={onUnsavedChangesChange} />);
  const editor = await screen.findByTestId<HTMLTextAreaElement>('editor');
  await waitFor(() => assert.equal(editor.value, 'hello'));
  return { onClose, editor };
};

const typeInto = (editor: HTMLTextAreaElement, value: string) => {
  fireEvent.change(editor, { target: { value } });
};

const pressEscape = () => {
  fireEvent.keyDown(document, { key: 'Escape' });
};

// Compared as a boolean rather than against the element: a failed
// `assert.equal(<jsdom node>, null)` inspects the whole node tree and takes the
// test runner down with it.
const isDirtyDotShown = () => screen.queryByLabelText('Unsaved changes') !== null;

test('Escape with unsaved edits asks first and stays open when declined', async () => {
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  const { onClose, editor } = await renderEditor();

  typeInto(editor, 'hello edited');
  pressEscape();

  assert.equal(confirm.mock.calls.length, 1);
  assert.match(String(confirm.mock.calls[0][0]), /unsaved changes/i);
  assert.equal(onClose.mock.calls.length, 0);
  // The edit is still there to be saved.
  assert.equal(screen.getByTestId<HTMLTextAreaElement>('editor').value, 'hello edited');
});

test('Escape with unsaved edits closes once the user accepts', async () => {
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
  const { onClose, editor } = await renderEditor();

  typeInto(editor, 'hello edited');
  pressEscape();

  assert.equal(confirm.mock.calls.length, 1);
  assert.equal(onClose.mock.calls.length, 1);
});

test('Escape with a clean buffer closes without asking', async () => {
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  const { onClose } = await renderEditor();

  pressEscape();

  assert.equal(confirm.mock.calls.length, 0);
  assert.equal(onClose.mock.calls.length, 1);
});

test('an Escape already handled elsewhere in the page is left alone', async () => {
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  // Stands in for the chat aborting a run or a composer menu closing: they also
  // listen on the document and call preventDefault(). Registered before the
  // editor mounts and in the capture phase so it runs first, as they do.
  const handledElsewhere = (event: KeyboardEvent) => event.preventDefault();
  document.addEventListener('keydown', handledElsewhere, true);

  try {
    const { onClose, editor } = await renderEditor();
    typeInto(editor, 'hello edited');

    fireEvent.keyDown(document.body, { key: 'Escape' });

    assert.equal(confirm.mock.calls.length, 0);
    assert.equal(onClose.mock.calls.length, 0);

    // The next Escape nobody else claims still reaches the editor.
    document.removeEventListener('keydown', handledElsewhere, true);
    fireEvent.keyDown(document.body, { key: 'Escape' });
    assert.equal(confirm.mock.calls.length, 1);
  } finally {
    document.removeEventListener('keydown', handledElsewhere, true);
  }
});

const openLayer = (attributes: Record<string, string>) => {
  const layer = document.createElement('div');
  Object.entries(attributes).forEach(([name, value]) => layer.setAttribute(name, value));
  document.body.appendChild(layer);
  return layer;
};

test('Escape that closes Settings over a dirty editor does not ask to discard it', async () => {
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  const { onClose, editor } = await renderEditor();
  typeInto(editor, 'hello edited');

  // Shaped like Settings: a modal dialog closing on a window-level Escape that
  // it does not consume, opened from the editor's own gear so focus stays there.
  const settings = openLayer({ role: 'dialog', 'aria-modal': 'true' });
  const closeSettings = vi.fn(() => settings.remove());
  const closeSettingsOnEscape = (event: KeyboardEvent) => {
    if (event.key === 'Escape') closeSettings();
  };
  window.addEventListener('keydown', closeSettingsOnEscape);
  try {
    fireEvent.keyDown(editor, { key: 'Escape' });
  } finally {
    window.removeEventListener('keydown', closeSettingsOnEscape);
    settings.remove();
  }

  assert.equal(closeSettings.mock.calls.length, 1);
  assert.equal(confirm.mock.calls.length, 0);
  assert.equal(onClose.mock.calls.length, 0);

  // With Settings gone the next Escape is the editor's again.
  pressEscape();
  assert.equal(confirm.mock.calls.length, 1);
});

test('Escape is left to an open menu or marked escape layer', async () => {
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  const { onClose, editor } = await renderEditor();
  typeInto(editor, 'hello edited');

  // The file tree's context menu and the shared ActionMenu close on Escape
  // without consuming it.
  for (const attributes of [{ role: 'menu' }, { 'data-escape-layer': '' }]) {
    const layer = openLayer(attributes);
    fireEvent.keyDown(layer, { key: 'Escape' });
    layer.remove();
  }

  assert.equal(confirm.mock.calls.length, 0);
  assert.equal(onClose.mock.calls.length, 0);
});

test('a CRLF file is not dirty just because CodeMirror reports LF', async () => {
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  readFile.mockImplementationOnce(async () => ({ ok: true, json: async () => ({ content: 'first\r\nsecond' }) }));

  const onClose = vi.fn();
  render(<CodeEditor file={file} onClose={onClose} />);
  const editor = await screen.findByTestId<HTMLTextAreaElement>('editor');
  // Like CodeMirror, a textarea reports the document with LF line endings.
  await waitFor(() => assert.equal(editor.value, 'first\nsecond'));
  assert.equal(isDirtyDotShown(), false);

  typeInto(editor, 'first\nsecond edited');
  assert.equal(isDirtyDotShown(), true);

  // Undone by hand: the buffer matches the file again, CRLF or not.
  typeInto(editor, 'first\nsecond');

  assert.equal(isDirtyDotShown(), false);
  pressEscape();
  assert.equal(confirm.mock.calls.length, 0);
  assert.equal(onClose.mock.calls.length, 1);
});

test('a save still in flight when another file opens leaves that file clean', async () => {
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  let releaseSave: (() => void) | null = null;
  saveFile.mockImplementationOnce(async () => {
    await new Promise<void>((resolve) => { releaseSave = resolve; });
    return { ok: true, json: async () => ({ success: true }) };
  });
  readFile.mockImplementationOnce(async () => ({ ok: true, json: async () => ({ content: 'hello' }) }));
  readFile.mockImplementationOnce(async () => ({ ok: true, json: async () => ({ content: 'other file' }) }));

  const onClose = vi.fn();
  const { rerender } = render(<CodeEditor file={file} onClose={onClose} />);
  const editor = await screen.findByTestId<HTMLTextAreaElement>('editor');
  await waitFor(() => assert.equal(editor.value, 'hello'));

  typeInto(editor, 'hello edited');
  fireEvent.keyDown(document, { key: 's', ctrlKey: true });
  await waitFor(() => assert.equal(saveFile.mock.calls.length, 1));

  // The user accepts the switch while the write is still on the wire.
  rerender(<CodeEditor file={otherFile} onClose={onClose} />);
  await waitFor(() => assert.equal(screen.getByTestId<HTMLTextAreaElement>('editor').value, 'other file'));

  await act(async () => {
    releaseSave?.();
  });
  // Back to the plain save title: neither the old file's baseline nor its
  // "saved" tick was allowed to land on the file that is open now.
  await waitFor(() => assert.ok(screen.getByTitle('actions.save')));

  assert.equal(isDirtyDotShown(), false);
  pressEscape();
  assert.equal(confirm.mock.calls.length, 0);
  assert.equal(onClose.mock.calls.length, 1);
});

// A macrotask boundary lets a released request's whole promise chain settle.
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

test('a slow read of the previous file never replaces the one open now', async () => {
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  let releaseFirstRead: (() => void) | null = null;
  readFile.mockImplementationOnce(async () => {
    await new Promise<void>((resolve) => { releaseFirstRead = resolve; });
    return { ok: true, json: async () => ({ content: 'hello' }) };
  });
  readFile.mockImplementationOnce(async () => ({ ok: true, json: async () => ({ content: 'other file' }) }));

  const onClose = vi.fn();
  const { rerender } = render(<CodeEditor file={file} onClose={onClose} />);
  rerender(<CodeEditor file={otherFile} onClose={onClose} />);
  const editor = await screen.findByTestId<HTMLTextAreaElement>('editor');
  await waitFor(() => assert.equal(editor.value, 'other file'));
  typeInto(editor, 'other file edited');

  await act(async () => {
    releaseFirstRead?.();
    await settle();
  });

  assert.equal(screen.getByTestId<HTMLTextAreaElement>('editor').value, 'other file edited');
  assert.equal(isDirtyDotShown(), true);
  pressEscape();
  assert.equal(confirm.mock.calls.length, 1);
  assert.equal(onClose.mock.calls.length, 0);
});

test('a failed save of the previous file is not reported on the one open now', async () => {
  let failSave: ((error: Error) => void) | null = null;
  saveFile.mockImplementationOnce(async () => {
    await new Promise<void>((_resolve, reject) => { failSave = reject; });
    return { ok: true, json: async () => ({ success: true }) };
  });
  readFile.mockImplementationOnce(async () => ({ ok: true, json: async () => ({ content: 'hello' }) }));
  readFile.mockImplementationOnce(async () => ({ ok: true, json: async () => ({ content: 'other file' }) }));
  vi.spyOn(console, 'error').mockImplementation(() => undefined);

  const onClose = vi.fn();
  const { rerender } = render(<CodeEditor file={file} onClose={onClose} />);
  const editor = await screen.findByTestId<HTMLTextAreaElement>('editor');
  await waitFor(() => assert.equal(editor.value, 'hello'));
  typeInto(editor, 'hello edited');
  fireEvent.keyDown(document, { key: 's', ctrlKey: true });
  await waitFor(() => assert.equal(saveFile.mock.calls.length, 1));

  rerender(<CodeEditor file={otherFile} onClose={onClose} />);
  await waitFor(() => assert.equal(screen.getByTestId<HTMLTextAreaElement>('editor').value, 'other file'));
  await act(async () => {
    failSave?.(new Error('disk full'));
    await settle();
  });

  assert.equal(screen.queryByText('disk full') !== null, false);
  // The open file can be saved straight away rather than waiting on the old write.
  assert.equal(screen.getByTitle('actions.save').hasAttribute('disabled'), false);
});

test('the header close button is guarded the same way', async () => {
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  const { onClose, editor } = await renderEditor();

  typeInto(editor, 'hello edited');
  // No i18n instance is initialised here, so labels without a default render as their key.
  fireEvent.click(screen.getByTitle('actions.close'));

  assert.equal(confirm.mock.calls.length, 1);
  assert.equal(onClose.mock.calls.length, 0);
});

test('a successful save clears the dirty state', async () => {
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  const { onClose, editor } = await renderEditor();

  typeInto(editor, 'hello edited');
  fireEvent.keyDown(document, { key: 's', ctrlKey: true });
  await waitFor(() => assert.equal(saveFile.mock.calls.length, 1));
  // The dot in the header goes away once the write has landed.
  await waitFor(() => assert.equal(isDirtyDotShown(), false));

  pressEscape();

  assert.equal(confirm.mock.calls.length, 0);
  assert.equal(onClose.mock.calls.length, 1);
});

test('the header shows a dirty indicator only while there are unsaved edits', async () => {
  const { editor } = await renderEditor();
  assert.equal(isDirtyDotShown(), false);

  typeInto(editor, 'hello edited');
  assert.equal(isDirtyDotShown(), true);

  // Undoing the edit by hand makes the buffer match the disk again.
  typeInto(editor, 'hello');
  assert.equal(isDirtyDotShown(), false);
});

test('leaving the page is only intercepted while there are unsaved edits', async () => {
  const { editor } = await renderEditor();

  const askClean = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(askClean);
  assert.equal(askClean.defaultPrevented, false);

  typeInto(editor, 'hello edited');
  const askDirty = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(askDirty);
  assert.equal(askDirty.defaultPrevented, true);
});

test('dirtiness is reported upward and reset when the editor unmounts', async () => {
  const onUnsavedChangesChange = vi.fn();
  const onClose = vi.fn();
  const { unmount } = render(
    <CodeEditor file={file} onClose={onClose} onUnsavedChangesChange={onUnsavedChangesChange} />,
  );
  const editor = await screen.findByTestId<HTMLTextAreaElement>('editor');
  await waitFor(() => assert.equal(editor.value, 'hello'));

  typeInto(editor, 'hello edited');
  assert.equal(onUnsavedChangesChange.mock.calls.at(-1)?.[0], true);

  unmount();
  assert.equal(onUnsavedChangesChange.mock.calls.at(-1)?.[0], false);
});

const project: Project = { projectId: 'p1', displayName: 'repo', fullPath: '/repo', path: '/repo' };

test('switching to another file while dirty asks first and keeps the current one when declined', () => {
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  const { result } = renderHook(() => useEditorSidebar({ selectedProject: project, isMobile: false }));

  act(() => result.current.handleFileOpen('/repo/a.txt'));
  act(() => result.current.handleUnsavedChangesChange(true));
  act(() => result.current.handleFileOpen('/repo/b.txt'));

  assert.equal(confirm.mock.calls.length, 1);
  assert.equal(result.current.editingFile?.path, '/repo/a.txt');

  confirm.mockReturnValue(true);
  act(() => result.current.handleFileOpen('/repo/b.txt'));

  assert.equal(confirm.mock.calls.length, 2);
  assert.equal(result.current.editingFile?.path, '/repo/b.txt');
});

test('re-opening the open file, or opening while clean, never asks', () => {
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  const { result } = renderHook(() => useEditorSidebar({ selectedProject: project, isMobile: false }));

  // Nothing open yet: the first open can have nothing to lose.
  act(() => result.current.handleUnsavedChangesChange(true));
  act(() => result.current.handleFileOpen('/repo/a.txt'));
  assert.equal(confirm.mock.calls.length, 0);

  // Same path again reuses the buffer, so there is nothing to confirm.
  act(() => result.current.handleFileOpen('/repo/a.txt'));
  assert.equal(confirm.mock.calls.length, 0);
  assert.equal(result.current.editingFile?.path, '/repo/a.txt');

  // Clean buffer: another file opens straight away.
  act(() => result.current.handleUnsavedChangesChange(false));
  act(() => result.current.handleFileOpen('/repo/b.txt'));
  assert.equal(confirm.mock.calls.length, 0);
  assert.equal(result.current.editingFile?.path, '/repo/b.txt');
});

test('re-opening the open path with a diff payload reloads the buffer, so it asks first', () => {
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  const { result } = renderHook(() => useEditorSidebar({ selectedProject: project, isMobile: false }));

  act(() => result.current.handleFileOpen('/repo/a.txt'));
  act(() => result.current.handleUnsavedChangesChange(true));
  act(() => result.current.handleFileOpen('/repo/a.txt', { old_string: 'a', new_string: 'b' }));

  assert.equal(confirm.mock.calls.length, 1);
  assert.equal(result.current.editingFile?.diffInfo, null);
});

test('the same path in another project is a different file, so it asks first', () => {
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  // Nested projects list the same absolute paths, and the editor re-reads the
  // file whenever its project changes.
  const nestedProject: Project = { projectId: 'p2', displayName: 'sub', fullPath: '/repo/sub', path: '/repo/sub' };
  const { result, rerender } = renderHook(
    ({ selectedProject }) => useEditorSidebar({ selectedProject, isMobile: false }),
    { initialProps: { selectedProject: project } },
  );

  act(() => result.current.handleFileOpen('/repo/sub/a.txt'));
  act(() => result.current.handleUnsavedChangesChange(true));
  rerender({ selectedProject: nestedProject });
  act(() => result.current.handleFileOpen('/repo/sub/a.txt'));

  assert.equal(confirm.mock.calls.length, 1);
  assert.equal(result.current.editingFile?.projectId, 'p1');

  confirm.mockReturnValue(true);
  act(() => result.current.handleFileOpen('/repo/sub/a.txt'));
  assert.equal(result.current.editingFile?.projectId, 'p2');
});
