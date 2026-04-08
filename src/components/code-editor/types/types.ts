export type { CodeEditorFile } from '@/hooks/code-editor-sidebar/types.js';

export type CodeEditorSettingsState = {
  isDarkMode: boolean;
  wordWrap: boolean;
  minimapEnabled: boolean;
  showLineNumbers: boolean;
  fontSize: string;
};
