import { useEffect } from 'react';

interface GlobalShortcutHandlers {
  onNewChat?: () => void;
  onToggleSidebar?: () => void;
  onOpenSettings?: () => void;
  onFocusSearch?: () => void;
  onSwitchTab?: (index: number) => void;
  onShowShortcuts?: () => void;
}

export function useGlobalShortcuts({
  onNewChat,
  onToggleSidebar,
  onOpenSettings,
  onFocusSearch,
  onSwitchTab,
  onShowShortcuts,
}: GlobalShortcutHandlers) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;

      if (e.key === 'n' && !e.shiftKey) {
        e.preventDefault();
        onNewChat?.();
      } else if (e.key === 'S' && e.shiftKey) {
        e.preventDefault();
        onToggleSidebar?.();
      } else if (e.key === ',') {
        e.preventDefault();
        onOpenSettings?.();
      } else if (e.key === 'k') {
        e.preventDefault();
        onFocusSearch?.();
      } else if (e.key === '?' && e.shiftKey) {
        e.preventDefault();
        onShowShortcuts?.();
      } else if (e.key >= '1' && e.key <= '9' && onSwitchTab) {
        e.preventDefault();
        onSwitchTab(parseInt(e.key, 10) - 1);
      }
    };

    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onNewChat, onToggleSidebar, onOpenSettings, onFocusSearch, onSwitchTab, onShowShortcuts]);
}
