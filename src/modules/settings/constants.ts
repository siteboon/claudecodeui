import type { AgentCategory, AgentProvider, CodeEditorSettingsState, CursorPermissionsState, ProjectSortOrder } from '@/shared/types';

export const AGENT_PROVIDERS: AgentProvider[] = ['claude', 'cursor', 'codex', 'opencode'];
export const AGENT_CATEGORIES: AgentCategory[] = ['account', 'permissions', 'mcp'];

export const DEFAULT_PROJECT_SORT_ORDER: ProjectSortOrder = 'name';
export const DEFAULT_SAVE_STATUS = null;
export const DEFAULT_CODE_EDITOR_SETTINGS: CodeEditorSettingsState = {
  wordWrap: false,
  showMinimap: true,
  lineNumbers: true,
  fontSize: '14',
};

export const DEFAULT_CURSOR_PERMISSIONS: CursorPermissionsState = {
  allowedCommands: [],
  disallowedCommands: [],
  skipPermissions: false,
};
