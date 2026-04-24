const isMac =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform);

export const MOD_KEY = isMac ? '⌘' : 'Ctrl';
export const ALT_KEY = isMac ? '⌥' : 'Alt';
export const SHIFT_KEY = isMac ? '⇧' : 'Shift';

export type ShortcutEntry = {
  id: string;
  label: string;
  keys: string[];
};

export const SHORTCUTS: ShortcutEntry[] = [
  { id: 'palette', label: 'Open command palette', keys: [MOD_KEY, 'K'] },
  { id: 'newSession', label: 'New session in active project', keys: [MOD_KEY, 'N'] },
  { id: 'archiveSession', label: 'Archive current session', keys: [MOD_KEY, 'W'] },
  { id: 'jumpSession', label: 'Jump to session 1–9', keys: [ALT_KEY, '1–9'] },
  { id: 'jumpProject', label: 'Switch project 1–6', keys: [ALT_KEY, SHIFT_KEY, '1–6'] },
  { id: 'cycleProject', label: 'Cycle projects in command palette', keys: [SHIFT_KEY, 'Tab'] },
  { id: 'clearFilter', label: 'Clear project filter', keys: ['Ctrl', '`'] },
];
