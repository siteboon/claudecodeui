import { useEffect } from 'react';

type UsePrdKeyboardShortcutsArgs = {
  onSave: () => void;
  onClose: () => void;
};

export function usePrdKeyboardShortcuts({
  onSave,
  onClose,
}: UsePrdKeyboardShortcutsArgs): void {
  useEffect(() => {
    // Keep shortcuts global so the editor behaves consistently in fullscreen and modal mode.
    const handleKeyDown = (event: KeyboardEvent) => {
      const loweredKey = event.key.toLowerCase();

      if ((event.ctrlKey || event.metaKey) && loweredKey === 's') {
        event.preventDefault();
        onSave();
        return;
      }

      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose, onSave]);
}
