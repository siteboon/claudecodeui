import {
  Brain,
  Eye,
  GitBranch,
  Languages,
  Mic,
} from 'lucide-react';

import type { PreferenceToggleItem } from './types';

export const HANDLE_POSITION_STORAGE_KEY = 'quickSettingsHandlePosition';

export const DEFAULT_HANDLE_POSITION = 50;
export const HANDLE_POSITION_MIN = 10;
export const HANDLE_POSITION_MAX = 90;
export const DRAG_THRESHOLD_PX = 5;

export const SETTING_ROW_CLASS =
  'flex items-center justify-between p-3 rounded-lg bg-muted/60 hover:bg-accent transition-colors border border-transparent hover:border-border';

export const TOGGLE_ROW_CLASS = `${SETTING_ROW_CLASS} cursor-pointer`;

export const CHECKBOX_CLASS =
  'h-4 w-4 rounded border-gray-300 dark:border-gray-600 text-blue-600 dark:text-blue-500 focus:ring-blue-500 focus:ring-2 dark:focus:ring-blue-400 bg-gray-100 dark:bg-gray-800 checked:bg-blue-600 dark:checked:bg-blue-600';

export const TOOL_DISPLAY_TOGGLES: PreferenceToggleItem[] = [
  {
    key: 'showRawParameters',
    labelKey: 'quickSettings.showRawParameters',
    icon: Eye,
  },
  {
    key: 'showThinking',
    labelKey: 'quickSettings.showThinking',
    icon: Brain,
  },
  {
    key: 'showSubagentSessions',
    labelKey: 'quickSettings.showSubagentSessions',
    icon: GitBranch,
  },
];

export const INPUT_SETTING_TOGGLES: PreferenceToggleItem[] = [
  {
    key: 'sendByCtrlEnter',
    labelKey: 'quickSettings.sendByCtrlEnter',
    icon: Languages,
  },
  {
    key: 'voiceEnabled',
    labelKey: 'quickSettings.voiceEnabled',
    icon: Mic,
  },
];
