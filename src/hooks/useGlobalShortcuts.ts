import { useEffect } from 'react';

interface GlobalShortcutHandlers {
  onNewChat?: () => void;
  onToggleSidebar?: () => void;
  onOpenSettings?: () => void;
  onFocusSearch?: () => void;
}

export function useGlobalShortcuts({
  onNewChat,
  onToggleSidebar,
  onOpenSettings,
  onFocusSearch,
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
      }
    };

    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onNewChat, onToggleSidebar, onOpenSettings, onFocusSearch]);
}
