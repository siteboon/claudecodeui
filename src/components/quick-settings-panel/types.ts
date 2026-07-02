import type { CSSProperties } from 'react';
import type { LucideIcon } from 'lucide-react';

export type PreferenceToggleKey =
  | 'showRawParameters'
  | 'showThinking'
  | 'sendByCtrlEnter';

export type QuickSettingsPreferences = Record<PreferenceToggleKey, boolean>;

export type PreferenceToggleItem = {
  key: PreferenceToggleKey;
  labelKey: string;
  icon: LucideIcon;
};

export type QuickSettingsHandleStyle = CSSProperties;
