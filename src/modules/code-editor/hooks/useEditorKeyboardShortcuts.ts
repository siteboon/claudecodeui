import { useEffect } from 'react';

// Open menus, modal dialogs and layers using the app's `data-escape-layer`
// marker sit above the editor and close on Escape themselves.
const ESCAPE_LAYER_SELECTOR = '[data-escape-layer], [aria-modal="true"], [role="menu"]';

type UseEditorKeyboardShortcutsParams = {
  onSave: () => void;
  onClose: () => void;
  dependency: string;
};

export const useEditorKeyboardShortcuts = ({
  onSave,
  onClose,
  dependency,
}: UseEditorKeyboardShortcutsParams) => {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        // Leave Escapes another handler consumed or a layer above the editor owns.
        if (event.defaultPrevented || document.querySelector(ESCAPE_LAYER_SELECTOR)) {
          return;
        }

        event.preventDefault();
        onClose();
        return;
      }

      if (!(event.ctrlKey || event.metaKey)) {
        return;
      }

      if (event.key.toLowerCase() === 's') {
        event.preventDefault();
        onSave();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [dependency, onClose, onSave]);
};
