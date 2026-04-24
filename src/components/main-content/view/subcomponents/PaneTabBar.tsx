import { X } from 'lucide-react';

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform);

export interface PaneTabBarTab {
  paneId: string;
  label: string;
  subLabel?: string;
}

interface PaneHeaderProps {
  label: string;
  index: number;
  isFocused: boolean;
  onFocus: () => void;
  onClose: () => void;
}

export default function PaneHeader({ label, index, isFocused, onFocus, onClose }: PaneHeaderProps) {
  const shortcut = isMac ? `⌘⇧${index + 1}` : `Ctrl+Shift+${index + 1}`;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onFocus}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onFocus(); }}
      className={`flex items-center gap-2 border-b px-3 py-1 text-xs cursor-pointer select-none transition-colors ${
        isFocused
          ? 'bg-background text-foreground'
          : 'bg-muted/30 text-muted-foreground hover:bg-muted/50'
      }`}
      style={isFocused ? { borderBottomColor: 'var(--project-accent)' } : undefined}
    >
      <span className="flex-1 truncate font-medium">{label}</span>
      <span className="shrink-0 rounded bg-muted px-1 font-mono text-[9px] text-muted-foreground/60">
        {shortcut}
      </span>
      <button
        type="button"
        aria-label="Close pane"
        onClick={(e) => { e.stopPropagation(); onClose(); }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); onClose(); }
        }}
        className="rounded p-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}
