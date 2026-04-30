export type CommandKey = {
  isMac: boolean;
  modKey: '⌘' | 'Ctrl';
};

export function useCommandKey(): CommandKey {
  const isMac =
    typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
  return { isMac, modKey: isMac ? '⌘' : 'Ctrl' };
}
