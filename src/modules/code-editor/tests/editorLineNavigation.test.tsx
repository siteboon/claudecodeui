import assert from 'node:assert/strict';

import { EditorState } from '@codemirror/state';
import { render, screen } from '@testing-library/react';
import { useEffect } from 'react';
import { test, vi } from 'vitest';

import type { CodeEditorGotoTarget, MarkdownViewMode } from '@/shared/types';

/**
 * Regression guard: a `path:line` reference must move the caret once, when the
 * document arrives — and never again. The surface is a controlled CodeMirror,
 * so `content` changes on every keystroke; while it drove the jump, editing a
 * file opened at line 130 dragged the caret back there after each character.
 */

const dispatch = vi.fn();
const documentText = Array.from({ length: 20 }, (_, index) => `line ${index + 1}`).join('\n');

// Stands in for the real editor: enough of an EditorView for the jump to be
// computed against a real document, and to record what it dispatched.
const view = { state: EditorState.create({ doc: documentText }), dispatch };

vi.mock('@uiw/react-codemirror', () => {
  function CodeMirrorStub({ onCreateEditor }: { onCreateEditor?: (view: unknown) => void }) {
    // Handed over after mount, as the real editor does: the surface has to wait
    // for the view before it can jump anywhere.
    useEffect(() => {
      onCreateEditor?.(view);
    }, [onCreateEditor]);
    return <div data-testid="editor" />;
  }

  return { default: CodeMirrorStub };
});

// The Live editor's view: the same document, its own dispatch, so a test can
// tell which editor a jump landed in.
const liveDispatch = vi.fn();
const liveView = { state: EditorState.create({ doc: documentText }), dispatch: liveDispatch };

vi.mock('@openmarkdown-dev/editor', () => ({
  openMarkdownText: (source: string) => ({ text: source, source }),
  saveMarkdownText: (doc: string) => doc,
  createEditorState: (options: unknown) => options,
  mountEditor: (parent: HTMLElement) => {
    const dom = document.createElement('div');
    dom.dataset.testid = 'live-editor';
    parent.appendChild(dom);
    return {
      view: Object.assign(liveView, { dom }),
      getDoc: () => documentText,
      setDoc: () => undefined,
      setEnvironment: () => undefined,
      destroy: () => dom.remove(),
    };
  },
}));

const { default: CodeEditorSurface } = await import('@/modules/code-editor/CodeEditorSurface');

const renderSurface = (content: string, gotoTarget: CodeEditorGotoTarget | null) =>
  render(
    <CodeEditorSurface
      content={content}
      onChange={() => undefined}
      markdownMode="code"
      isMarkdownFile={false}
      isDarkMode={false}
      fontSize={14}
      showLineNumbers
      extensions={[]}
      gotoTarget={gotoTarget}
    />,
  );

/** Where the last dispatched selection landed, as a 1-based line number. */
const lastSelectedLine = () => {
  const anchor = dispatch.mock.calls.at(-1)?.[0]?.selection?.anchor as number;
  return view.state.doc.lineAt(anchor).number;
};

test('the requested line is selected once the document is there', () => {
  dispatch.mockReset();
  renderSurface(documentText, { line: 12 });
  assert.equal(dispatch.mock.calls.length, 1);
  assert.equal(lastSelectedLine(), 12);
});

test('editing the file does not pull the caret back to the reference', () => {
  dispatch.mockReset();
  const target = { line: 12 };
  const { rerender } = renderSurface(documentText, target);
  assert.equal(dispatch.mock.calls.length, 1);

  // What a keystroke looks like from here: same request, new content.
  rerender(
    <CodeEditorSurface
      content={`${documentText}!`}
      onChange={() => undefined}
      markdownMode="code"
      isMarkdownFile={false}
      isDarkMode={false}
      fontSize={14}
      showLineNumbers
      extensions={[]}
      gotoTarget={target}
    />,
  );
  assert.equal(dispatch.mock.calls.length, 1);
});

test('clicking the same reference again is a new request and jumps again', () => {
  dispatch.mockReset();
  const { rerender } = renderSurface(documentText, { line: 12 });
  rerender(
    <CodeEditorSurface
      content={documentText}
      onChange={() => undefined}
      markdownMode="code"
      isMarkdownFile={false}
      isDarkMode={false}
      fontSize={14}
      showLineNumbers
      extensions={[]}
      gotoTarget={{ line: 12 }}
    />,
  );
  assert.equal(dispatch.mock.calls.length, 2);
});

test('a line past the end of the file lands on its last line', () => {
  dispatch.mockReset();
  renderSurface(documentText, { line: 999 });
  assert.equal(lastSelectedLine(), 20);
});

test('an empty file opened at line 1 gets the caret there, and a paste does not move it', () => {
  dispatch.mockReset();
  const loadedState = view.state;
  view.state = EditorState.create({ doc: '' });
  try {
    // `notes.md:1` followed while notes.md is empty.
    const target = { line: 1 };
    const { rerender } = renderSurface('', target);
    assert.equal(dispatch.mock.calls.length, 1);
    assert.equal(dispatch.mock.calls[0][0].selection.anchor, 0);

    // Two lines pasted into it: same request, content no longer empty.
    rerender(
      <CodeEditorSurface
        content={'first\nsecond'}
        onChange={() => undefined}
        markdownMode="code"
        isMarkdownFile={false}
        isDarkMode={false}
        fontSize={14}
        showLineNumbers
        extensions={[]}
        gotoTarget={target}
      />,
    );
    assert.equal(dispatch.mock.calls.length, 1);
  } finally {
    view.state = loadedState;
  }
});

test('a file opened with no line reference is left alone', () => {
  dispatch.mockReset();
  renderSurface(documentText, null);
  assert.equal(dispatch.mock.calls.length, 0);
});

const renderMarkdownSurface = (markdownMode: MarkdownViewMode, gotoTarget: CodeEditorGotoTarget | null) => (
  <CodeEditorSurface
    content={documentText}
    onChange={() => undefined}
    markdownMode={markdownMode}
    isMarkdownFile
    isDarkMode={false}
    fontSize={14}
    showLineNumbers
    extensions={[]}
    gotoTarget={gotoTarget}
  />
);

test('a reference followed while Live is shown jumps in the Live editor', async () => {
  dispatch.mockReset();
  liveDispatch.mockReset();
  const { rerender } = render(renderMarkdownSurface('code', null));
  rerender(renderMarkdownSurface('live', null));
  await screen.findByTestId('live-editor');

  // `notes.md:12` clicked in chat while notes.md is open in Live.
  rerender(renderMarkdownSurface('live', { line: 12 }));
  assert.equal(dispatch.mock.calls.length, 0);
  assert.equal(liveDispatch.mock.calls.length, 1);
  const anchor = liveDispatch.mock.calls[0][0].selection.anchor as number;
  assert.equal(liveView.state.doc.lineAt(anchor).number, 12);
});

test('switching between Code and Live does not replay a reference already shown', async () => {
  dispatch.mockReset();
  liveDispatch.mockReset();
  const target = { line: 12 };
  const { rerender } = render(renderMarkdownSurface('code', target));
  assert.equal(dispatch.mock.calls.length, 1);

  rerender(renderMarkdownSurface('live', target));
  await screen.findByTestId('live-editor');
  rerender(renderMarkdownSurface('code', target));
  await screen.findByTestId('editor');
  assert.equal(liveDispatch.mock.calls.length, 0);
  assert.equal(dispatch.mock.calls.length, 1);
});

test('a reference followed while Preview is shown waits for the next editing view', async () => {
  dispatch.mockReset();
  liveDispatch.mockReset();
  const target = { line: 12 };
  const { rerender } = render(renderMarkdownSurface('code', null));
  rerender(renderMarkdownSurface('preview', null));
  rerender(renderMarkdownSurface('preview', target));
  // The Code view it came from is gone; nothing may be sent to it.
  assert.equal(dispatch.mock.calls.length, 0);

  rerender(renderMarkdownSurface('code', target));
  await screen.findByTestId('editor');
  assert.equal(dispatch.mock.calls.length, 1);
  assert.equal(lastSelectedLine(), 12);
});
