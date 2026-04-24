import { useEffect } from 'react';
import { X } from 'lucide-react';

import { KbdCombo } from './Kbd';
import { SHORTCUTS } from './shortcuts';

type Props = {
  onClose: () => void;
};

export default function ShortcutsPanel({ onClose }: Props) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div className="border-t border-border/60 bg-background/98 backdrop-blur-sm">
      <div className="flex items-center justify-between px-3 py-2">
        <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground/70">
          Keyboard shortcuts
        </span>
        <button
          type="button"
          onClick={onClose}
          className="flex rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground"
          aria-label="Close shortcuts"
        >
          <X className="h-3 w-3" />
        </button>
      </div>
      <ul className="max-h-52 overflow-y-auto divide-y divide-border/30 pb-1">
        {SHORTCUTS.map((shortcut) => (
          <li
            key={shortcut.id}
            className="flex items-center justify-between gap-4 px-3 py-1.5"
          >
            <span className="text-[12px] text-muted-foreground">{shortcut.label}</span>
            <KbdCombo keys={shortcut.keys} />
          </li>
        ))}
      </ul>
    </div>
  );
}
