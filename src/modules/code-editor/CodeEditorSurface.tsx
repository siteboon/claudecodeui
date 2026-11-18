import { Component, lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { EditorView } from '@codemirror/view';
import { oneDark } from '@codemirror/theme-one-dark';
import type { Extension } from '@codemirror/state';

import type { CodeEditorGotoTarget, MarkdownViewMode } from '@/shared/types';
import MarkdownPreview from '@/modules/code-editor/markdown/MarkdownPreview';

// The Live editor (and its CodeMirror extensions) loads only when first used.
const createLiveMarkdownEditor = () => lazy(() => import('@/modules/code-editor/markdown/LiveMarkdownEditor'));

// Replaced after a failed load: React caches a rejected lazy import and would
// rethrow it on every later render, so picking Live again needs a fresh one.
let LiveMarkdownEditor = createLiveMarkdownEditor();

type LiveEditorBoundaryProps = {
  onError: () => void;
  children: ReactNode;
};

/**
 * Keeps a Live editor that fails to load (a network error, a chunk removed by
 * a redeploy) or to mount from taking the editor down with it. It sits below
 * CodeEditor, so the buffer and its unsaved edits survive, and reports the
 * failure so the editor can fall back to the Code view.
 */
class LiveEditorBoundary extends Component<LiveEditorBoundaryProps, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch() {
    LiveMarkdownEditor = createLiveMarkdownEditor();
    this.props.onError();
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}

type CodeEditorSurfaceProps = {
  content: string;
  onChange: (value: string) => void;
  markdownMode: MarkdownViewMode;
  isMarkdownFile: boolean;
  isDarkMode: boolean;
  fontSize: number;
  showLineNumbers: boolean;
  extensions: Extension[];
  // The open file's path. The Live editor starts a fresh state (and undo
  // history) when it changes.
  filePath?: string;
  // Line to reveal once the document is loaded (`path:line` references).
  gotoTarget?: CodeEditorGotoTarget | null;
  // The Live editor's accessible name, naming the file it edits.
  liveEditorLabel?: string;
  // Called when the Live editor cannot load or mount; the owner switches the
  // file back to the Code view.
  onLiveEditorError?: () => void;
};

/** The editing surfaces that hold a CodeMirror view a line reference can jump in. */
type EditingSurface = 'code' | 'live';

/** Rendered by CodeEditor inside the code-editor module to show the CodeMirror editing surface, or, for Markdown files, the read-only preview or the Live editor. */
export default function CodeEditorSurface({
  content,
  onChange,
  markdownMode,
  isMarkdownFile,
  isDarkMode,
  fontSize,
  showLineNumbers,
  extensions,
  filePath,
  gotoTarget = null,
  liveEditorLabel,
  onLiveEditorError,
}: CodeEditorSurfaceProps) {
  const activeSurface: MarkdownViewMode = isMarkdownFile ? markdownMode : 'code';

  // The CodeMirror view of the editing surface on screen, Code or Live, tagged
  // with the surface it belongs to. Tracked as state, not a ref: the view is
  // created after the first render, and a ref would not re-run the jump effect
  // once it lands. The tag keeps a view from a surface just switched away from
  // (already destroyed) from taking a line reference.
  const [editorView, setEditorView] = useState<{ surface: EditingSurface; view: EditorView } | null>(null);

  const handleCodeEditorCreated = useCallback((view: EditorView) => {
    setEditorView({ surface: 'code', view });
  }, []);

  const handleLiveEditorCreated = useCallback((view: EditorView) => {
    setEditorView({ surface: 'live', view });
  }, []);

  // Leaving a surface destroys its view; forget it so a line reference that
  // arrives while another view is shown waits for the next editing surface.
  useEffect(() => {
    const leaving = activeSurface;
    return () => setEditorView((current) => (current?.surface === leaving ? null : current));
  }, [activeSurface]);

  // The last request already jumped to, so a view handed over again (switching
  // between Code and Live) does not replay a request already shown. Shared by
  // Code and Live.
  const jumpedToRef = useRef<CodeEditorGotoTarget | null>(null);

  // CodeEditor renders this surface only once the file has loaded, so a view
  // that is handed over already holds the document, an empty file included.
  // The jump waits only for the view; each request is then applied exactly
  // once, in whichever editing surface is on screen. Edits to the file do not
  // re-run it, so the caret is never dragged back to the requested line.
  useEffect(() => {
    if (
      !editorView
      || editorView.surface !== activeSurface
      || !gotoTarget
      || jumpedToRef.current === gotoTarget
    ) {
      return;
    }
    jumpedToRef.current = gotoTarget;
    const { view } = editorView;
    const target = Math.min(Math.max(gotoTarget.line, 1), view.state.doc.lines);
    const line = view.state.doc.line(target);
    view.dispatch({
      selection: { anchor: line.from },
      effects: EditorView.scrollIntoView(line.from, { y: 'center' }),
    });
  }, [editorView, activeSurface, gotoTarget]);

  if (activeSurface === 'live') {
    return (
      <LiveEditorBoundary onError={() => onLiveEditorError?.()}>
        <Suspense fallback={null}>
          <LiveMarkdownEditor
            content={content}
            onChange={onChange}
            isDarkMode={isDarkMode}
            fontSize={fontSize}
            filePath={filePath}
            ariaLabel={liveEditorLabel}
            onCreateEditor={handleLiveEditorCreated}
          />
        </Suspense>
      </LiveEditorBoundary>
    );
  }

  if (activeSurface === 'preview') {
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
      onCreateEditor={handleCodeEditorCreated}
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
