import React, { useState, useEffect, useRef, useMemo } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { javascript } from '@codemirror/lang-javascript';
import { python } from '@codemirror/lang-python';
import { html } from '@codemirror/lang-html';
import { css } from '@codemirror/lang-css';
import { json } from '@codemirror/lang-json';
import { markdown } from '@codemirror/lang-markdown';
import { oneDark } from '@codemirror/theme-one-dark';
import { StreamLanguage } from '@codemirror/language';
import { EditorView, showPanel, ViewPlugin } from '@codemirror/view';
import { unifiedMergeView, getChunks } from '@codemirror/merge';
import { showMinimap } from '@replit/codemirror-minimap';
import { X, Save, Download, Maximize2, Minimize2, Settings as SettingsIcon } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import rehypeRaw from 'rehype-raw';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark as prismOneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { api } from '../utils/api';
import { useTranslation } from 'react-i18next';
import { Eye, Code2 } from 'lucide-react';

// Custom .env file syntax highlighting
const envLanguage = StreamLanguage.define({
  token(stream) {
    // Comments
    if (stream.match(/^#.*/)) return 'comment';
    // Key (before =)
    if (stream.sol() && stream.match(/^[A-Za-z_][A-Za-z0-9_.]*(?==)/)) return 'variableName.definition';
    // Equals sign
    if (stream.match(/^=/)) return 'operator';
    // Double-quoted string
    if (stream.match(/^"(?:[^"\\]|\\.)*"?/)) return 'string';
    // Single-quoted string
    if (stream.match(/^'(?:[^'\\]|\\.)*'?/)) return 'string';
    // Variable interpolation ${...}
    if (stream.match(/^\$\{[^}]*\}?/)) return 'variableName.special';
    // Variable reference $VAR
    if (stream.match(/^\$[A-Za-z_][A-Za-z0-9_]*/)) return 'variableName.special';
    // Numbers
    if (stream.match(/^\d+/)) return 'number';
    // Skip other characters
    stream.next();
    return null;
  },
});

function MarkdownCodeBlock({ inline, className, children, ...props }) {
  const [copied, setCopied] = useState(false);
  const raw = Array.isArray(children) ? children.join('') : String(children ?? '');
  const looksMultiline = /[\r\n]/.test(raw);
  const shouldInline = inline || !looksMultiline;

  if (shouldInline) {
    return (
      <code
        className={`font-mono text-[0.9em] px-1.5 py-0.5 rounded-md bg-gray-100 text-gray-900 border border-gray-200 dark:bg-gray-800/60 dark:text-gray-100 dark:border-gray-700 whitespace-pre-wrap break-words ${className || ''}`}
        {...props}
      >
        {children}
      </code>
    );
  }

  const match = /language-(\w+)/.exec(className || '');
  const language = match ? match[1] : 'text';

  return (
    <div className="relative group my-2">
      {language && language !== 'text' && (
        <div className="absolute top-2 left-3 z-10 text-xs text-gray-400 font-medium uppercase">{language}</div>
      )}
      <button
        type="button"
        onClick={() => {
          navigator.clipboard?.writeText(raw).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          });
        }}
        className="absolute top-2 right-2 z-10 opacity-0 group-hover:opacity-100 transition-opacity text-xs px-2 py-1 rounded-md bg-gray-700/80 hover:bg-gray-700 text-white border border-gray-600"
      >
        {copied ? 'Copied!' : 'Copy'}
      </button>
      <SyntaxHighlighter
        language={language}
        style={prismOneDark}
        customStyle={{
          margin: 0,
          borderRadius: '0.5rem',
          fontSize: '0.875rem',
          padding: language && language !== 'text' ? '2rem 1rem 1rem 1rem' : '1rem',
        }}
      >
        {raw}
      </SyntaxHighlighter>
    </div>
  );
}

const markdownPreviewComponents = {
  code: MarkdownCodeBlock,
  blockquote: ({ children }) => (
    <blockquote className="border-l-4 border-gray-300 dark:border-gray-600 pl-4 italic text-gray-600 dark:text-gray-400 my-2">
      {children}
    </blockquote>
  ),
  a: ({ href, children }) => (
    <a href={href} className="text-blue-600 dark:text-blue-400 hover:underline" target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  ),
  table: ({ children }) => (
    <div className="overflow-x-auto my-2">
      <table className="min-w-full border-collapse border border-gray-200 dark:border-gray-700">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-gray-50 dark:bg-gray-800">{children}</thead>,
  th: ({ children }) => (
    <th className="px-3 py-2 text-left text-sm font-semibold border border-gray-200 dark:border-gray-700">{children}</th>
  ),
  td: ({ children }) => (
    <td className="px-3 py-2 align-top text-sm border border-gray-200 dark:border-gray-700">{children}</td>
  ),
};

function MarkdownPreview({ content }) {
  const remarkPlugins = useMemo(() => [remarkGfm, remarkMath], []);
  const rehypePlugins = useMemo(() => [rehypeRaw, rehypeKatex], []);

  return (
    <ReactMarkdown
      remarkPlugins={remarkPlugins}
      rehypePlugins={rehypePlugins}
      components={markdownPreviewComponents}
    >
      {content}
    </ReactMarkdown>
  );
}

function CodeEditor({ file, onClose, projectPath, isSidebar = false, isExpanded = false, onToggleExpand = null, onPopOut = null }) {
  const { t } = useTranslation('codeEditor');
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isDarkMode, setIsDarkMode] = useState(() => {
    const savedTheme = localStorage.getItem('codeEditorTheme');
    return savedTheme ? savedTheme === 'dark' : true;
  });
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [showDiff, setShowDiff] = useState(!!file.diffInfo);
  const [wordWrap, setWordWrap] = useState(() => {
    return localStorage.getItem('codeEditorWordWrap') === 'true';
  });
  const [minimapEnabled, setMinimapEnabled] = useState(() => {
    return localStorage.getItem('codeEditorShowMinimap') !== 'false';
  });
  const [showLineNumbers, setShowLineNumbers] = useState(() => {
    return localStorage.getItem('codeEditorLineNumbers') !== 'false';
  });
  const [fontSize, setFontSize] = useState(() => {
    return localStorage.getItem('codeEditorFontSize') || '12';
  });
  const [markdownPreview, setMarkdownPreview] = useState(false);
  const editorRef = useRef(null);

  // Check if file is markdown
  const isMarkdownFile = useMemo(() => {
    const ext = file.name.split('.').pop()?.toLowerCase();
    return ext === 'md' || ext === 'markdown';
  }, [file.name]);

  // Create minimap extension with chunk-based gutters
  const minimapExtension = useMemo(() => {
    if (!file.diffInfo || !showDiff || !minimapEnabled) return [];

    const gutters = {};

    return [
      showMinimap.compute(['doc'], (state) => {
        // Get actual chunks from merge view
        const chunksData = getChunks(state);
        const chunks = chunksData?.chunks || [];

        // Clear previous gutters
        Object.keys(gutters).forEach(key => delete gutters[key]);

        // Mark lines that are part of chunks
        chunks.forEach(chunk => {
          // Mark the lines in the B side (current document)
          const fromLine = state.doc.lineAt(chunk.fromB).number;
          const toLine = state.doc.lineAt(Math.min(chunk.toB, state.doc.length)).number;

          for (let lineNum = fromLine; lineNum <= toLine; lineNum++) {
            gutters[lineNum] = isDarkMode ? 'rgba(34, 197, 94, 0.8)' : 'rgba(34, 197, 94, 1)';
          }
        });

        return {
          create: () => ({ dom: document.createElement('div') }),
          displayText: 'blocks',
          showOverlay: 'always',
          gutters: [gutters]
        };
      })
    ];
  }, [file.diffInfo, showDiff, minimapEnabled, isDarkMode]);

  // Create extension to scroll to first chunk on mount
  const scrollToFirstChunkExtension = useMemo(() => {
    if (!file.diffInfo || !showDiff) return [];

    return [
      ViewPlugin.fromClass(class {
        constructor(view) {
          // Delay to ensure merge view is fully initialized
          setTimeout(() => {
            const chunksData = getChunks(view.state);
            const chunks = chunksData?.chunks || [];

            if (chunks.length > 0) {
              const firstChunk = chunks[0];

              // Scroll to the first chunk
              view.dispatch({
                effects: EditorView.scrollIntoView(firstChunk.fromB, { y: 'center' })
              });
            }
          }, 100);
        }

        update() {}
        destroy() {}
      })
    ];
  }, [file.diffInfo, showDiff]);

  // Whether toolbar has any buttons worth showing
  const hasToolbarButtons = !!(file.diffInfo || (isSidebar && onPopOut) || (isSidebar && onToggleExpand));

  // Create editor toolbar panel - only when there are buttons to show
  const editorToolbarPanel = useMemo(() => {
    if (!hasToolbarButtons) return [];

    const createPanel = (view) => {
      const dom = document.createElement('div');
      dom.className = 'cm-editor-toolbar-panel';

      let currentIndex = 0;

      const updatePanel = () => {
        // Check if we have diff info and it's enabled
        const hasDiff = file.diffInfo && showDiff;
        const chunksData = hasDiff ? getChunks(view.state) : null;
        const chunks = chunksData?.chunks || [];
        const chunkCount = chunks.length;

        // Build the toolbar HTML
        let toolbarHTML = '<div style="display: flex; align-items: center; justify-content: space-between; width: 100%;">';

        // Left side - diff navigation (if applicable)
        toolbarHTML += '<div style="display: flex; align-items: center; gap: 8px;">';
        if (hasDiff) {
          toolbarHTML += `
            <span style="font-weight: 500;">${chunkCount > 0 ? `${currentIndex + 1}/${chunkCount}` : '0'} ${t('toolbar.changes')}</span>
            <button class="cm-diff-nav-btn cm-diff-nav-prev" title="${t('toolbar.previousChange')}" ${chunkCount === 0 ? 'disabled' : ''}>
              <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 15l7-7 7 7" />
              </svg>
            </button>
            <button class="cm-diff-nav-btn cm-diff-nav-next" title="${t('toolbar.nextChange')}" ${chunkCount === 0 ? 'disabled' : ''}>
              <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
              </svg>
            </button>
          `;
        }
        toolbarHTML += '</div>';

        // Right side - action buttons
        toolbarHTML += '<div style="display: flex; align-items: center; gap: 4px;">';

        // Show/hide diff button (only if there's diff info)
        if (file.diffInfo) {
          toolbarHTML += `
            <button class="cm-toolbar-btn cm-toggle-diff-btn" title="${showDiff ? t('toolbar.hideDiff') : t('toolbar.showDiff')}">
              <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                ${showDiff ?
                  '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />' :
                  '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />'
                }
              </svg>
            </button>
          `;
        }

        // Pop out button (only in sidebar mode with onPopOut)
        if (isSidebar && onPopOut) {
          toolbarHTML += `
            <button class="cm-toolbar-btn cm-popout-btn" title="Open in modal">
              <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6M10 14L21 3" />
              </svg>
            </button>
          `;
        }

        // Expand button (only in sidebar mode)
        if (isSidebar && onToggleExpand) {
          toolbarHTML += `
            <button class="cm-toolbar-btn cm-expand-btn" title="${isExpanded ? t('toolbar.collapse') : t('toolbar.expand')}">
              <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                ${isExpanded ?
                  '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 9V4.5M9 9H4.5M9 9L3.75 3.75M9 15v4.5M9 15H4.5M9 15l-5.25 5.25M15 9h4.5M15 9V4.5M15 9l5.25-5.25M15 15h4.5M15 15v4.5m0-4.5l5.25 5.25" />' :
                  '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />'
                }
              </svg>
            </button>
          `;
        }

        toolbarHTML += '</div>';
        toolbarHTML += '</div>';

        dom.innerHTML = toolbarHTML;

        if (hasDiff) {
          const prevBtn = dom.querySelector('.cm-diff-nav-prev');
          const nextBtn = dom.querySelector('.cm-diff-nav-next');

          prevBtn?.addEventListener('click', () => {
            if (chunks.length === 0) return;
            currentIndex = currentIndex > 0 ? currentIndex - 1 : chunks.length - 1;

            const chunk = chunks[currentIndex];
            if (chunk) {
              view.dispatch({
                effects: EditorView.scrollIntoView(chunk.fromB, { y: 'center' })
              });
            }
            updatePanel();
          });

          nextBtn?.addEventListener('click', () => {
            if (chunks.length === 0) return;
            currentIndex = currentIndex < chunks.length - 1 ? currentIndex + 1 : 0;

            const chunk = chunks[currentIndex];
            if (chunk) {
              view.dispatch({
                effects: EditorView.scrollIntoView(chunk.fromB, { y: 'center' })
              });
            }
            updatePanel();
          });
        }

        if (file.diffInfo) {
          const toggleDiffBtn = dom.querySelector('.cm-toggle-diff-btn');
          toggleDiffBtn?.addEventListener('click', () => {
            setShowDiff(!showDiff);
          });
        }

        if (isSidebar && onPopOut) {
          const popoutBtn = dom.querySelector('.cm-popout-btn');
          popoutBtn?.addEventListener('click', () => {
            onPopOut();
          });
        }

        if (isSidebar && onToggleExpand) {
          const expandBtn = dom.querySelector('.cm-expand-btn');
          expandBtn?.addEventListener('click', () => {
            onToggleExpand();
          });
        }
      };

      updatePanel();

      return {
        top: true,
        dom,
        update: updatePanel
      };
    };

    return [showPanel.of(createPanel)];
  }, [file.diffInfo, showDiff, isSidebar, isExpanded, onToggleExpand, onPopOut]);

  // Get language extension based on file extension
  const getLanguageExtension = (filename) => {
    const lowerName = filename.toLowerCase();
    // Handle dotfiles like .env, .env.local, .env.production, etc.
    if (lowerName === '.env' || lowerName.startsWith('.env.')) {
      return [envLanguage];
    }
    const ext = filename.split('.').pop()?.toLowerCase();
    switch (ext) {
      case 'js':
      case 'jsx':
      case 'ts':
      case 'tsx':
        return [javascript({ jsx: true, typescript: ext.includes('ts') })];
      case 'py':
        return [python()];
      case 'html':
      case 'htm':
        return [html()];
      case 'css':
      case 'scss':
      case 'less':
        return [css()];
      case 'json':
        return [json()];
      case 'md':
      case 'markdown':
        return [markdown()];
      case 'env':
        return [envLanguage];
      default:
        return [];
    }
  };

  // Load file content
  useEffect(() => {
    const loadFileContent = async () => {
      try {
        setLoading(true);

        // If we have diffInfo with both old and new content, we can show the diff directly
        // This handles both GitPanel (full content) and ChatInterface (full content from API)
        if (file.diffInfo && file.diffInfo.new_string !== undefined && file.diffInfo.old_string !== undefined) {
          // Use the new_string as the content to display
          // The unifiedMergeView will compare it against old_string
          setContent(file.diffInfo.new_string);
          setLoading(false);
          return;
        }

        // Otherwise, load from disk
        const response = await api.readFile(file.projectName, file.path);

        if (!response.ok) {
          throw new Error(`Failed to load file: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();
        setContent(data.content);
      } catch (error) {
        console.error('Error loading file:', error);
        setContent(`// Error loading file: ${error.message}\n// File: ${file.name}\n// Path: ${file.path}`);
      } finally {
        setLoading(false);
      }
    };

    loadFileContent();
  }, [file, projectPath]);

  const handleSave = async () => {
    setSaving(true);
    try {
      console.log('Saving file:', {
        projectName: file.projectName,
        path: file.path,
        contentLength: content?.length
      });

      const response = await api.saveFile(file.projectName, file.path, content);

      console.log('Save response:', {
        status: response.status,
        ok: response.ok,
        contentType: response.headers.get('content-type')
      });

      if (!response.ok) {
        const contentType = response.headers.get('content-type');
        if (contentType && contentType.includes('application/json')) {
          const errorData = await response.json();
          throw new Error(errorData.error || `Save failed: ${response.status}`);
        } else {
          const textError = await response.text();
          console.error('Non-JSON error response:', textError);
          throw new Error(`Save failed: ${response.status} ${response.statusText}`);
        }
      }

      const result = await response.json();
      console.log('Save successful:', result);

      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2000);

    } catch (error) {
      console.error('Error saving file:', error);
      alert(`Error saving file: ${error.message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleDownload = () => {
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const toggleFullscreen = () => {
    setIsFullscreen(!isFullscreen);
  };

  // Save theme preference to localStorage
  useEffect(() => {
    localStorage.setItem('codeEditorTheme', isDarkMode ? 'dark' : 'light');
  }, [isDarkMode]);

  // Save word wrap preference to localStorage
  useEffect(() => {
    localStorage.setItem('codeEditorWordWrap', wordWrap.toString());
  }, [wordWrap]);

  // Listen for settings changes from the Settings modal
  useEffect(() => {
    const handleStorageChange = () => {
      const newTheme = localStorage.getItem('codeEditorTheme');
      if (newTheme) {
        setIsDarkMode(newTheme === 'dark');
      }

      const newWordWrap = localStorage.getItem('codeEditorWordWrap');
      if (newWordWrap !== null) {
        setWordWrap(newWordWrap === 'true');
      }

      const newShowMinimap = localStorage.getItem('codeEditorShowMinimap');
      if (newShowMinimap !== null) {
        setMinimapEnabled(newShowMinimap !== 'false');
      }

      const newShowLineNumbers = localStorage.getItem('codeEditorLineNumbers');
      if (newShowLineNumbers !== null) {
        setShowLineNumbers(newShowLineNumbers !== 'false');
      }

      const newFontSize = localStorage.getItem('codeEditorFontSize');
      if (newFontSize) {
        setFontSize(newFontSize);
      }
    };

    // Listen for storage events (changes from other tabs/windows)
    window.addEventListener('storage', handleStorageChange);

    // Custom event for same-window updates
    window.addEventListener('codeEditorSettingsChanged', handleStorageChange);

    return () => {
      window.removeEventListener('storage', handleStorageChange);
      window.removeEventListener('codeEditorSettingsChanged', handleStorageChange);
    };
  }, []);

  // Handle keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.ctrlKey || e.metaKey) {
        if (e.key === 's') {
          e.preventDefault();
          handleSave();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          onClose();
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [content]);

  if (loading) {
    return (
      <>
        <style>
          {`
            .code-editor-loading {
              background-color: ${isDarkMode ? '#111827' : '#ffffff'} !important;
            }
            .code-editor-loading:hover {
              background-color: ${isDarkMode ? '#111827' : '#ffffff'} !important;
            }
          `}
        </style>
        {isSidebar ? (
          <div className="w-full h-full flex items-center justify-center bg-background">
            <div className="flex items-center gap-3">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"></div>
              <span className="text-gray-900 dark:text-white">{t('loading', { fileName: file.name })}</span>
            </div>
          </div>
        ) : (
          <div className="fixed inset-0 z-[9999] md:bg-black/50 md:flex md:items-center md:justify-center">
            <div className="code-editor-loading w-full h-full md:rounded-lg md:w-auto md:h-auto p-8 flex items-center justify-center">
              <div className="flex items-center gap-3">
                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"></div>
                <span className="text-gray-900 dark:text-white">{t('loading', { fileName: file.name })}</span>
              </div>
            </div>
          </div>
        )}
      </>
    );
  }

  return (
    <>
      <style>
        {`
          /* Light background for full line changes */
          .cm-deletedChunk {
            background-color: ${isDarkMode ? 'rgba(239, 68, 68, 0.15)' : 'rgba(255, 235, 235, 1)'} !important;
            border-left: 3px solid ${isDarkMode ? 'rgba(239, 68, 68, 0.6)' : 'rgb(239, 68, 68)'} !important;
            padding-left: 4px !important;
          }

          .cm-insertedChunk {
            background-color: ${isDarkMode ? 'rgba(34, 197, 94, 0.15)' : 'rgba(230, 255, 237, 1)'} !important;
            border-left: 3px solid ${isDarkMode ? 'rgba(34, 197, 94, 0.6)' : 'rgb(34, 197, 94)'} !important;
            padding-left: 4px !important;
          }

          /* Override linear-gradient underline and use solid darker background for partial changes */
          .cm-editor.cm-merge-b .cm-changedText {
            background: ${isDarkMode ? 'rgba(34, 197, 94, 0.4)' : 'rgba(34, 197, 94, 0.3)'} !important;
            padding-top: 2px !important;
            padding-bottom: 2px !important;
            margin-top: -2px !important;
            margin-bottom: -2px !important;
          }

          .cm-editor .cm-deletedChunk .cm-changedText {
            background: ${isDarkMode ? 'rgba(239, 68, 68, 0.4)' : 'rgba(239, 68, 68, 0.3)'} !important;
            padding-top: 2px !important;
            padding-bottom: 2px !important;
            margin-top: -2px !important;
            margin-bottom: -2px !important;
          }

          /* Minimap gutter styling */
          .cm-gutter.cm-gutter-minimap {
            background-color: ${isDarkMode ? '#1e1e1e' : '#f5f5f5'};
          }

          /* Editor toolbar panel styling */
          .cm-editor-toolbar-panel {
            padding: 4px 10px;
            background-color: ${isDarkMode ? '#1f2937' : '#ffffff'};
            border-bottom: 1px solid ${isDarkMode ? '#374151' : '#e5e7eb'};
            color: ${isDarkMode ? '#d1d5db' : '#374151'};
            font-size: 12px;
          }

          .cm-diff-nav-btn,
          .cm-toolbar-btn {
            padding: 3px;
            background: transparent;
            border: none;
            cursor: pointer;
            border-radius: 4px;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            color: inherit;
            transition: background-color 0.2s;
          }

          .cm-diff-nav-btn:hover,
          .cm-toolbar-btn:hover {
            background-color: ${isDarkMode ? '#374151' : '#f3f4f6'};
          }

          .cm-diff-nav-btn:disabled {
            opacity: 0.5;
            cursor: not-allowed;
          }
        `}
      </style>
      <div className={isSidebar ?
        'w-full h-full flex flex-col' :
        `fixed inset-0 z-[9999] ${
          // Mobile: native fullscreen, Desktop: modal with backdrop
          'md:bg-black/50 md:flex md:items-center md:justify-center md:p-4'
        } ${isFullscreen ? 'md:p-0' : ''}`}>
        <div className={isSidebar ?
          'bg-background flex flex-col w-full h-full' :
          `bg-background shadow-2xl flex flex-col ${
          // Mobile: always fullscreen, Desktop: modal sizing
          'w-full h-full md:rounded-lg md:shadow-2xl' +
          (isFullscreen ? ' md:w-full md:h-full md:rounded-none' : ' md:w-full md:max-w-6xl md:h-[80vh] md:max-h-[80vh]')
        }`}>
        {/* Header */}
        <div className="flex items-center justify-between px-3 py-1.5 border-b border-border flex-shrink-0 min-w-0">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 min-w-0">
                <h3 className="text-sm font-medium text-gray-900 dark:text-white truncate">{file.name}</h3>
                {file.diffInfo && (
                  <span className="text-[10px] bg-blue-100 dark:bg-blue-900 text-blue-600 dark:text-blue-300 px-1.5 py-0.5 rounded whitespace-nowrap">
                    {t('header.showingChanges')}
                  </span>
                )}
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{file.path}</p>
            </div>
          </div>

          <div className="flex items-center gap-0.5 md:gap-1 flex-shrink-0">
            {isMarkdownFile && (
              <button
                onClick={() => setMarkdownPreview(!markdownPreview)}
                className={`p-1.5 rounded-md min-w-[36px] min-h-[36px] md:min-w-0 md:min-h-0 flex items-center justify-center transition-colors ${
                  markdownPreview
                    ? 'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30'
                    : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-800'
                }`}
                title={markdownPreview ? t('actions.editMarkdown') : t('actions.previewMarkdown')}
              >
                {markdownPreview ? <Code2 className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            )}

            <button
              onClick={() => window.openSettings?.('appearance')}
              className="p-1.5 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 min-w-[36px] min-h-[36px] md:min-w-0 md:min-h-0 flex items-center justify-center"
              title={t('toolbar.settings')}
            >
              <SettingsIcon className="w-4 h-4" />
            </button>

            <button
              onClick={handleDownload}
              className="p-1.5 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 min-w-[36px] min-h-[36px] md:min-w-0 md:min-h-0 flex items-center justify-center"
              title={t('actions.download')}
            >
              <Download className="w-4 h-4" />
            </button>

            <button
              onClick={handleSave}
              disabled={saving}
              className={`p-1.5 rounded-md disabled:opacity-50 flex items-center justify-center transition-colors min-w-[36px] min-h-[36px] md:min-w-0 md:min-h-0 ${
                saveSuccess
                  ? 'text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/30'
                  : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-800'
              }`}
              title={saveSuccess ? t('actions.saved') : saving ? t('actions.saving') : t('actions.save')}
            >
              {saveSuccess ? (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              ) : (
                <Save className="w-4 h-4" />
              )}
            </button>

            {!isSidebar && (
              <button
                onClick={toggleFullscreen}
                className="hidden md:flex p-1.5 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 items-center justify-center"
                title={isFullscreen ? t('actions.exitFullscreen') : t('actions.fullscreen')}
              >
                {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
              </button>
            )}

            <button
              onClick={onClose}
              className="p-1.5 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 min-w-[36px] min-h-[36px] md:min-w-0 md:min-h-0 flex items-center justify-center"
              title={t('actions.close')}
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Editor / Markdown Preview */}
        <div className="flex-1 overflow-hidden">
          {markdownPreview && isMarkdownFile ? (
            <div className="h-full overflow-y-auto bg-white dark:bg-gray-900">
              <div className="max-w-4xl mx-auto px-8 py-6 prose prose-sm dark:prose-invert prose-headings:font-semibold prose-a:text-blue-600 dark:prose-a:text-blue-400 prose-code:text-sm prose-pre:bg-gray-900 prose-img:rounded-lg max-w-none">
                <MarkdownPreview content={content} />
              </div>
            </div>
          ) : (
            <CodeMirror
              ref={editorRef}
              value={content}
              onChange={setContent}
              extensions={[
                ...getLanguageExtension(file.name),
                // Always show the toolbar
                ...editorToolbarPanel,
                // Only show diff-related extensions when diff is enabled
                ...(file.diffInfo && showDiff && file.diffInfo.old_string !== undefined
                  ? [
                      unifiedMergeView({
                        original: file.diffInfo.old_string,
                        mergeControls: false,
                        highlightChanges: true,
                        syntaxHighlightDeletions: false,
                        gutter: true
                        // NOTE: NO collapseUnchanged - this shows the full file!
                      }),
                      ...minimapExtension,
                      ...scrollToFirstChunkExtension
                    ]
                  : []),
                ...(wordWrap ? [EditorView.lineWrapping] : [])
              ]}
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
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-3 py-1.5 border-t border-border bg-muted flex-shrink-0">
          <div className="flex items-center gap-3 text-xs text-gray-600 dark:text-gray-400">
            <span>{t('footer.lines')} {content.split('\n').length}</span>
            <span>{t('footer.characters')} {content.length}</span>
          </div>

          <div className="text-xs text-gray-500 dark:text-gray-400">
            {t('footer.shortcuts')}
          </div>
        </div>
      </div>
    </div>
    </>
  );
}

export default CodeEditor;
