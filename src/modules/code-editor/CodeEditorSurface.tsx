import { useEffect, useRef, useState } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { EditorView } from '@codemirror/view';
import { oneDark } from '@codemirror/theme-one-dark';
import type { Extension } from '@codemirror/state';

import type { CodeEditorGotoTarget } from '@/shared/types';

import MarkdownPreview from '@/modules/code-editor/markdown/MarkdownPreview';

type CodeEditorSurfaceProps = {
  content: string;
  onChange: (value: string) => void;
  markdownPreview: boolean;
  isMarkdownFile: boolean;
  isDarkMode: boolean;
  fontSize: number;
  showLineNumbers: boolean;
  extensions: Extension[];
  // Line to reveal once the document is loaded (`path:line` references).
  gotoTarget?: CodeEditorGotoTarget | null;
};

/** Rendered by CodeEditor inside the code-editor module to show either the CodeMirror editing surface or the markdown preview. */
export default function CodeEditorSurface({
  content,
  onChange,
  markdownPreview,
  isMarkdownFile,
  isDarkMode,
  fontSize,
  showLineNumbers,
  extensions,
  gotoTarget = null,
}: CodeEditorSurfaceProps) {
  // Tracked as state, not a ref: the editor view is created after the first
  // render, and a ref would not re-run the effect once it lands.
  const [view, setView] = useState<EditorView | null>(null);

  // The last request already jumped to. `content` is the editor's own state and
  // changes on every keystroke, so without this the caret would be dragged back
  // to the requested line while the file is being edited.
  const jumpedToRef = useRef<CodeEditorGotoTarget | null>(null);

  // Content arrives asynchronously, so the jump waits for both the view and the
  // document; each request is then applied exactly once.
  useEffect(() => {
    if (!view || !gotoTarget || !content || jumpedToRef.current === gotoTarget) {
      return;
    }
    jumpedToRef.current = gotoTarget;
    const target = Math.min(Math.max(gotoTarget.line, 1), view.state.doc.lines);
    const line = view.state.doc.line(target);
    view.dispatch({
      selection: { anchor: line.from },
      effects: EditorView.scrollIntoView(line.from, { y: 'center' }),
    });
  }, [view, gotoTarget, content]);

  if (markdownPreview && isMarkdownFile) {
    return (
      <div className="h-full overflow-y-auto bg-white dark:bg-gray-900">
        <div className="prose prose-sm mx-auto max-w-4xl px-8 py-6 dark:prose-invert prose-headings:font-semibold prose-a:text-blue-600 prose-code:text-sm prose-pre:bg-gray-900 prose-img:rounded-lg dark:prose-a:text-blue-400">
          <MarkdownPreview content={content} />
        </div>
      </div>
    );
  }

  return (
    <CodeMirror
      onCreateEditor={setView}
      value={content}
      onChange={onChange}
      extensions={extensions}
      theme={isDarkMode ? oneDark : undefined}
      height="100%"
      style={{
        fontSize: `${fontSize}px`,
        height: '100%',
      }}
      basicSetup={{
        lineNumbers: showLineNumbers,
        foldGutter: true,
        dropCursor: false,
        allowMultipleSelections: false,
        indentOnInput: true,
        bracketMatching: true,
        closeBrackets: true,
        autocompletion: true,
        highlightSelectionMatches: true,
        searchKeymap: true,
      }}
    />
  );
}
