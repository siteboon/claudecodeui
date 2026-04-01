import type { CSSProperties } from 'react';
import type { LucideIcon } from 'lucide-react';

export type PreferenceToggleKey =
  | 'autoExpandTools'
  | 'showRawParameters'
  | 'showThinking'
  | 'autoScrollToBottom'
  | 'sendByCtrlEnter';

export type QuickSettingsPreferences = Record<PreferenceToggleKey, boolean>;

export type PreferenceToggleItem = {
  key: PreferenceToggleKey;
  labelKey: string;
  icon: LucideIcon;
};

export type WhisperMode =
  | 'default'
  | 'prompt'
  | 'vibe'
  | 'instructions'
  | 'architect';

export type WhisperOptionValue = 'default' | 'prompt' | 'vibe';

export type WhisperOption = {
  value: WhisperOptionValue;
  titleKey: string;
  descriptionKey: string;
  icon: LucideIcon;
};

export type QuickSettingsHandleStyle = CSSProperties;
