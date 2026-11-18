import { useEffect, useRef } from 'react';
import { LanguageDescription } from '@codemirror/language';
import type { EditorView } from '@codemirror/view';
import { createEditorState, mountEditor, openMarkdownText, saveMarkdownText } from '@openmarkdown-dev/editor';
import type { EditorHost, EditorOwnEnvironment, MarkdownEditor, MarkdownText } from '@openmarkdown-dev/editor';

import { copyTextToClipboard } from '@/shared/utils';

type LiveMarkdownEditorProps = {
  content: string;
  onChange: (value: string) => void;
  isDarkMode: boolean;
  fontSize: number;
  // The open file's path. Opening another file in the same pane starts a fresh
  // editor state; the same path (a `path:line` reference) keeps the current one.
  filePath?: string;
  // The editable text's accessible name. Read when a file's editor state is
  // created, so it follows the file opened.
  ariaLabel?: string;
  // Receives the editor's CodeMirror view once mounted, so the surface can
  // reveal `path:line` references in Live too.
  onCreateEditor?: (view: EditorView) => void;
};

// Fenced code is highlighted with the same CodeMirror languages the Code view
// already ships (see utils/editorExtensions.ts). Each one loads on first use.
const CODE_LANGUAGES = [
  LanguageDescription.of({
    name: 'JavaScript',
    alias: ['js', 'jsx', 'mjs', 'cjs', 'ecmascript', 'node'],
    extensions: ['js', 'jsx', 'mjs', 'cjs'],
    load: () => import('@codemirror/lang-javascript').then((m) => m.javascript({ jsx: true })),
  }),
  LanguageDescription.of({
    name: 'TypeScript',
    alias: ['ts', 'tsx', 'mts', 'cts'],
    extensions: ['ts', 'tsx', 'mts', 'cts'],
    load: () => import('@codemirror/lang-javascript').then((m) => m.javascript({ jsx: true, typescript: true })),
  }),
  LanguageDescription.of({
    name: 'Python',
    alias: ['py'],
    extensions: ['py'],
    load: () => import('@codemirror/lang-python').then((m) => m.python()),
  }),
  LanguageDescription.of({
    name: 'HTML',
    alias: ['htm', 'xhtml'],
    extensions: ['html', 'htm'],
    load: () => import('@codemirror/lang-html').then((m) => m.html()),
  }),
  LanguageDescription.of({
    name: 'CSS',
    alias: ['scss', 'less'],
    extensions: ['css', 'scss', 'less'],
    load: () => import('@codemirror/lang-css').then((m) => m.css()),
  }),
  LanguageDescription.of({
    name: 'JSON',
    alias: ['json5', 'jsonc'],
    extensions: ['json'],
    load: () => import('@codemirror/lang-json').then((m) => m.json()),
  }),
];

const environmentFor = (isDarkMode: boolean): EditorOwnEnvironment => ({
  colorScheme: isDarkMode ? 'dark' : 'light',
  // The code-block copy button. The app's helper falls back to a hidden
  // textarea where the async Clipboard API is missing (plain-http origins).
  copyText: (text) => copyTextToClipboard(text),
  openExternal: (url) => window.open(url, '_blank', 'noopener'),
});

/** A new editor state for one opened file: its text, an empty undo history and the caret at the start. */
const createLiveEditorState = (file: MarkdownText, isDarkMode: boolean, ariaLabel: string | undefined, host: EditorHost) => (
  createEditorState({
    doc: file.text,
    codeLanguages: CODE_LANGUAGES,
    environment: environmentFor(isDarkMode),
    ariaLabel,
    host,
  })
);

/**
 * Rendered lazily by CodeEditorSurface in the code-editor module as the Live
 * mode for Markdown files: @openmarkdown-dev/editor edits the same text
 * buffer as the Code view, so saving still goes through useCodeEditorDocument.
 * The package's text codec hands an unedited buffer back exactly as it was
 * loaded; an edited one keeps the BOM and writes the file's dominant line
 * ending on every line.
 */
export default function LiveMarkdownEditor({
  content,
  onChange,
  isDarkMode,
  fontSize,
  filePath,
  ariaLabel,
  onCreateEditor,
}: LiveMarkdownEditorProps) {
  const parentRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<MarkdownEditor | null>(null);
  const fileRef = useRef<MarkdownText | null>(null);
  // The path whose editor state is shown, to tell another file opened in this
  // pane from a `path:line` reference to the same one.
  const shownPathRef = useRef(filePath);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // One host for every file's state: it reads the current file and callback
  // through refs.
  const hostRef = useRef<EditorHost>({
    onChange: (doc, isUserEdit) => {
      if (!isUserEdit || !fileRef.current) return;
      onChangeRef.current(saveMarkdownText(doc, fileRef.current));
    },
  });

  useEffect(() => {
    if (!parentRef.current) return undefined;
    const file = openMarkdownText(content);
    fileRef.current = file;
    shownPathRef.current = filePath;
    editorRef.current = mountEditor(parentRef.current, createLiveEditorState(file, isDarkMode, ariaLabel, hostRef.current));
    onCreateEditor?.(editorRef.current.view);
    return () => {
      editorRef.current?.destroy();
      editorRef.current = null;
    };
    // Mount once; another file, buffer, theme and size changes are pushed in below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Another file opened in this pane (a Git panel open reuses the editor rather
  // than remounting it) gets a fresh state in the same view, so undo cannot
  // bring the previous file's text into it. The view stays, so the surface's
  // line-reference jumps keep working.
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || shownPathRef.current === filePath) return;
    shownPathRef.current = filePath;
    const file = openMarkdownText(content);
    fileRef.current = file;
    editor.view.setState(createLiveEditorState(file, isDarkMode, ariaLabel, hostRef.current));
    editor.syncAmbient();
    // Only a new path starts over; buffer and theme changes are handled below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filePath]);

  // Follow the app theme.
  useEffect(() => {
    editorRef.current?.setEnvironment(environmentFor(isDarkMode));
  }, [isDarkMode]);

  // Follow the editor font-size setting (the Live view reads a little larger).
  useEffect(() => {
    editorRef.current?.view.dom.style.setProperty('--ome-font-size', `${fontSize + 2}px`);
  }, [fontSize]);

  // A buffer change that did not come from this editor (reload from disk).
  useEffect(() => {
    const editor = editorRef.current;
    const file = fileRef.current;
    if (!editor || !file) return;
    if (saveMarkdownText(editor.getDoc(), file) === content) return;
    const next = openMarkdownText(content);
    fileRef.current = next;
    editor.setDoc(next.text);
  }, [content]);

  return <div ref={parentRef} className="openmarkdown-live h-full bg-white dark:bg-gray-900" />;
}
