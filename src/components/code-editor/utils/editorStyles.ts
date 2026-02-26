export const getEditorLoadingStyles = (isDarkMode: boolean) => {
  return `
    .code-editor-loading {
      background-color: ${isDarkMode ? '#111827' : '#ffffff'} !important;
    }

    .code-editor-loading:hover {
      background-color: ${isDarkMode ? '#111827' : '#ffffff'} !important;
    }
  `;
};

export const getEditorStyles = (isDarkMode: boolean) => {
  return `
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

    .cm-gutter.cm-gutter-minimap {
      background-color: ${isDarkMode ? '#1e1e1e' : '#f5f5f5'};
    }

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
  `;
};
