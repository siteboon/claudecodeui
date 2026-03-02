import { useMemo } from 'react';
import { markdown } from '@codemirror/lang-markdown';
import { oneDark } from '@codemirror/theme-one-dark';
import { EditorView } from '@codemirror/view';
import CodeMirror from '@uiw/react-codemirror';
import MarkdownPreview from '../../code-editor/view/subcomponents/markdown/MarkdownPreview';

type PrdEditorBodyProps = {
  content: string;
  onContentChange: (nextContent: string) => void;
  previewMode: boolean;
  isDarkMode: boolean;
  wordWrap: boolean;
};

export default function PrdEditorBody({
  content,
  onContentChange,
  previewMode,
  isDarkMode,
  wordWrap,
}: PrdEditorBodyProps) {
  const extensions = useMemo(
    () => [markdown(), ...(wordWrap ? [EditorView.lineWrapping] : [])],
    [wordWrap],
  );

  if (previewMode) {
    return (
      <div className="h-full overflow-y-auto p-6 prose prose-gray dark:prose-invert max-w-none">
        <MarkdownPreview content={content} />
      </div>
    );
  }

  return (
    <CodeMirror
      value={content}
      onChange={onContentChange}
      extensions={extensions}
      theme={isDarkMode ? oneDark : undefined}
      height="100%"
      style={{
        fontSize: '14px',
        height: '100%',
      }}
      basicSetup={{
        lineNumbers: true,
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
