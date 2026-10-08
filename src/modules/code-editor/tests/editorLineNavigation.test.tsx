import assert from 'node:assert/strict';

import { EditorState } from '@codemirror/state';
import { render } from '@testing-library/react';
import { useEffect } from 'react';
import { test, vi } from 'vitest';

import type { CodeEditorGotoTarget } from '@/shared/types';

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

const { default: CodeEditorSurface } = await import('@/modules/code-editor/CodeEditorSurface');

const renderSurface = (content: string, gotoTarget: CodeEditorGotoTarget | null) =>
  render(
    <CodeEditorSurface
      content={content}
      onChange={() => undefined}
      markdownPreview={false}
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
      markdownPreview={false}
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
      markdownPreview={false}
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

test('a file opened with no line reference is left alone', () => {
  dispatch.mockReset();
  renderSurface(documentText, null);
  assert.equal(dispatch.mock.calls.length, 0);
});
