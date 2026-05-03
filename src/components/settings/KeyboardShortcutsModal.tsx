import { useCallback, useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { createPortal } from 'react-dom';

const MOD =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl';

const SHORTCUT_GROUPS = [
  {
    title: 'General',
    shortcuts: [
      { keys: [MOD, 'N'], description: 'New conversation' },
      { keys: [MOD, 'Shift', 'S'], description: 'Toggle sidebar' },
      { keys: [MOD, ','], description: 'Open settings' },
      { keys: [MOD, 'K'], description: 'Command palette' },
      { keys: [MOD, '?'], description: 'Keyboard shortcuts' },
    ],
  },
  {
    title: 'Tabs',
    shortcuts: [
      { keys: [MOD, '1'], description: 'Chat tab' },
      { keys: [MOD, '2'], description: 'Shell tab' },
      { keys: [MOD, '3'], description: 'Files tab' },
      { keys: [MOD, '4'], description: 'Git tab' },
      { keys: [MOD, '5'], description: 'Tasks tab' },
    ],
  },
  {
    title: 'Chat',
    shortcuts: [
      { keys: ['Enter'], description: 'Send message' },
      { keys: ['Shift', 'Enter'], description: 'New line' },
      { keys: ['Escape'], description: 'Cancel / close' },
    ],
  },
];

interface KeyboardShortcutsModalProps {
  open: boolean;
  onClose: () => void;
}

export default function KeyboardShortcutsModal({ open, onClose }: KeyboardShortcutsModalProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (open) setVisible(true);
  }, [open]);

  const handleAnimationEnd = useCallback(() => {
    if (!open) setVisible(false);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!visible) return null;

  return createPortal(
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center bg-background/60 backdrop-blur-sm transition-opacity duration-150 ${open ? 'opacity-100' : 'opacity-0'}`}
      onClick={onClose}
      onTransitionEnd={handleAnimationEnd}
    >
      <div
        className={`w-full max-w-lg rounded-2xl border border-border bg-card p-6 shadow-xl transition-all duration-150 ${open ? 'scale-100 opacity-100' : 'scale-95 opacity-0'}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-foreground">Keyboard Shortcuts</h2>
          <button onClick={onClose} className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-5">
          {SHORTCUT_GROUPS.map((group) => (
            <div key={group.title}>
              <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">{group.title}</h3>
              <div className="space-y-1">
                {group.shortcuts.map((s) => (
                  <div key={s.description} className="flex items-center justify-between rounded-lg px-2 py-1.5 hover:bg-accent/50">
                    <span className="text-sm text-foreground">{s.description}</span>
                    <div className="flex items-center gap-1">
                      {s.keys.map((key) => (
                        <kbd key={key} className="inline-flex h-6 min-w-[24px] items-center justify-center rounded-md border border-border bg-muted px-1.5 font-mono text-[11px] text-muted-foreground">
                          {key}
                        </kbd>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>,
    document.body
  );
}
