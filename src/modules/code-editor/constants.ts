export const CODE_EDITOR_STORAGE_KEYS = {
  wordWrap: 'codeEditorWordWrap',
  showMinimap: 'codeEditorShowMinimap',
  lineNumbers: 'codeEditorLineNumbers',
  fontSize: 'codeEditorFontSize',
} as const;

export const CODE_EDITOR_DEFAULTS = {
  wordWrap: false,
  minimapEnabled: true,
  showLineNumbers: true,
  fontSize: '12',
} as const;

export const CODE_EDITOR_SETTINGS_CHANGED_EVENT = 'codeEditorSettingsChanged';
