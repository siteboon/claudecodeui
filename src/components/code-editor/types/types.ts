export type CodeEditorDiffInfo = {
  old_string?: string;
  new_string?: string;
  [key: string]: unknown;
};

export type CodeEditorFile = {
  name: string;
  path: string;
  // DB projectId; used by the editor to build `/api/file-tree/projects/:projectId/file`
  // URLs for reading and saving content.
  projectId?: string;
  // Marks a workspace-external document (e.g. an Antigravity plan file linked
  // from chat via `file://`). It is loaded through the read-only external
  // endpoint and saving is disabled.
  isReadOnlyExternal?: boolean;
  diffInfo?: CodeEditorDiffInfo | null;
  [key: string]: unknown;
};

export type CodeEditorSettingsState = {
  isDarkMode: boolean;
  wordWrap: boolean;
  minimapEnabled: boolean;
  showLineNumbers: boolean;
  fontSize: string;
};
