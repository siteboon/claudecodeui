import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';

interface Shortcut {
  keys: string;
  descriptionKey: string;
}

interface ShortcutCategory {
  titleKey: string;
  shortcuts: Shortcut[];
}

const CATEGORIES: ShortcutCategory[] = [
  {
    titleKey: 'shortcuts.general',
    shortcuts: [
      { keys: 'Ctrl+N', descriptionKey: 'shortcuts.newChat' },
      { keys: 'Ctrl+Shift+S', descriptionKey: 'shortcuts.toggleSidebar' },
      { keys: 'Ctrl+,', descriptionKey: 'shortcuts.openSettings' },
      { keys: 'Ctrl+K', descriptionKey: 'shortcuts.commandPalette' },
      { keys: 'Ctrl+?', descriptionKey: 'shortcuts.showShortcuts' },
    ],
  },
  {
    titleKey: 'shortcuts.chat',
    shortcuts: [
      { keys: 'Enter', descriptionKey: 'shortcuts.sendMessage' },
      { keys: 'Shift+Enter', descriptionKey: 'shortcuts.newLine' },
      { keys: 'Escape', descriptionKey: 'shortcuts.cancelEdit' },
      { keys: 'Ctrl+Shift+C', descriptionKey: 'shortcuts.copyLastMessage' },
    ],
  },
];

interface KeyboardShortcutsHelpProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function KeyboardShortcutsHelp({ isOpen, onClose }: KeyboardShortcutsHelpProps) {
  const { t } = useTranslation();

  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-background/80 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-xl border border-border bg-background shadow-2xl">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold text-foreground">{t('shortcuts.title')}</h2>
          <button
            type="button"
            aria-label={t('shortcuts.close')}
            onClick={onClose}
            className="rounded p-1 text-muted-foreground hover:bg-secondary"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="max-h-[60vh] overflow-y-auto p-4 space-y-6">
          {CATEGORIES.map((category) => (
            <div key={category.titleKey}>
              <h3 className="mb-2 text-xs font-semibold uppercase text-muted-foreground">
                {t(category.titleKey)}
              </h3>
              <div className="space-y-1">
                {category.shortcuts.map((shortcut) => (
                  <div
                    key={shortcut.keys}
                    className="flex items-center justify-between py-1"
                  >
                    <span className="text-sm text-foreground">{t(shortcut.descriptionKey)}</span>
                    <kbd className="rounded bg-secondary px-2 py-0.5 text-xs font-mono text-muted-foreground">
                      {shortcut.keys}
                    </kbd>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
