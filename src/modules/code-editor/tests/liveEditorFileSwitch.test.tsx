import assert from 'node:assert/strict';

import { fireEvent, render } from '@testing-library/react';
import type { EditorView } from '@codemirror/view';
import { test, vi } from 'vitest';

/**
 * The Live editor stays mounted when another file is opened in the same pane
 * (a Git panel open carries both snapshots, so there is no loading state in
 * between). Its undo history must not come along: undoing in the new file
 * would bring back the previous file's text, and saving would write it there.
 * A `path:line` reference to the file already open keeps the history.
 *
 * This runs the real @openmarkdown-dev/editor in jsdom.
 */

// jsdom lays nothing out; CodeMirror measures text ranges after each update.
Range.prototype.getClientRects = () => Object.assign([], { item: () => null }) as unknown as DOMRectList;
Range.prototype.getBoundingClientRect = () => new DOMRect();

const { default: LiveMarkdownEditor } = await import('@/modules/code-editor/markdown/LiveMarkdownEditor');

const editedText = '# Notes\n\nedited\n';

const renderLive = (filePath: string, content: string, onChange: (value: string) => void, onCreateEditor?: (view: EditorView) => void) => (
  <LiveMarkdownEditor
    content={content}
    onChange={onChange}
    isDarkMode={false}
    fontSize={14}
    filePath={filePath}
    onCreateEditor={onCreateEditor}
  />
);

/** Opens notes.md in Live and types a word into it, as a user would. */
const openAndEdit = () => {
  const onChange = vi.fn();
  let view: EditorView | null = null;
  const rendered = render(renderLive('/repo/notes.md', '# Notes\n', onChange, (created) => {
    view = created;
  }));
  assert.ok(view);
  const liveView = view as EditorView;
  liveView.dispatch({ changes: { from: liveView.state.doc.length, insert: '\nedited\n' }, userEvent: 'input.type' });
  assert.deepEqual(onChange.mock.calls, [[editedText]]);
  return { ...rendered, onChange, view: liveView };
};

const pressUndo = (view: EditorView) => {
  fireEvent.keyDown(view.contentDOM, { key: 'z', code: 'KeyZ', keyCode: 90, ctrlKey: true });
};

test('another file opened in the Live editor starts with no undo history', () => {
  const { rerender, onChange, view } = openAndEdit();

  // The new file's text equals the edited buffer, so nothing in the document
  // changes; only the file does.
  rerender(renderLive('/repo/other.md', editedText, onChange));
  pressUndo(view);

  assert.equal(view.state.doc.toString(), editedText);
  assert.equal(onChange.mock.calls.length, 1);
});

test('the same file shown again keeps its undo history', () => {
  const { rerender, onChange, view } = openAndEdit();

  // What a `path:line` reference to the open file looks like here.
  rerender(renderLive('/repo/notes.md', editedText, onChange));
  pressUndo(view);

  assert.equal(view.state.doc.toString(), '# Notes\n');
  assert.deepEqual(onChange.mock.calls.at(-1), ['# Notes\n']);
});
