import { useEffect } from 'react';

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
        // Escape is shared: the chat aborts a running session with it and the
        // composer's @-mention and slash-command menus close with it, all of
        // which call preventDefault() first. Only the last Escape in the page
        // should reach the editor, or a dirty buffer would ask to be discarded
        // every time one of those was dismissed.
        if (event.defaultPrevented) {
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
