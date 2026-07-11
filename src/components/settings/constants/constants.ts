import type { ComponentType } from 'react';
import {
  Bell,
  Bot,
  GitBranch,
  Info,
  KeyRound,
  ListChecks,
  MonitorPlay,
  Palette,
  Plug,
} from 'lucide-react';

import type {
  AgentCategory,
  AgentProvider,
  CodeEditorSettingsState,
  CursorPermissionsState,
  ProjectSortOrder,
  SettingsMainTab,
} from '../types/types';

export type SettingsMainTabMeta = {
  id: SettingsMainTab;
  labelKey: string;
  keywords: string;
  icon: ComponentType<{ className?: string }>;
};

export const SETTINGS_MAIN_TABS: SettingsMainTabMeta[] = [
  { id: 'agents', labelKey: 'mainTabs.agents', keywords: 'agents subagents claude code', icon: Bot },
  { id: 'appearance', labelKey: 'mainTabs.appearance', keywords: 'appearance theme dark light language', icon: Palette },
  { id: 'git', labelKey: 'mainTabs.git', keywords: 'git github commits', icon: GitBranch },
  { id: 'api', labelKey: 'mainTabs.apiTokens', keywords: 'api tokens auth keys', icon: KeyRound },
  { id: 'tasks', labelKey: 'mainTabs.tasks', keywords: 'tasks taskmaster', icon: ListChecks },
  { id: 'browser', labelKey: 'mainTabs.browser', keywords: 'browser playwright chromium automation', icon: MonitorPlay },
  { id: 'notifications', labelKey: 'mainTabs.notifications', keywords: 'notifications alerts push', icon: Bell },
  { id: 'plugins', labelKey: 'mainTabs.plugins', keywords: 'plugins extensions integrations', icon: Plug },
  { id: 'about', labelKey: 'mainTabs.about', keywords: 'about version info', icon: Info },
];

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
