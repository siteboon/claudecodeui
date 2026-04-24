import { X } from 'lucide-react';

export interface PaneTabBarTab {
  paneId: string;
  label: string;
  subLabel?: string;
}

interface PaneTabBarProps {
  tabs: PaneTabBarTab[];
  focusedPaneId: string | null;
  onFocus: (paneId: string) => void;
  onClose?: (paneId: string) => void;
}

// The tab strip for multi-session view. Adding a new pane happens through
// shift-click on a sidebar session or the (deferred) command-palette action —
// there is deliberately no "+" button here because "open WHICH session?"
// doesn't have a sensible answer without context. The MAX_PANES cap is
// enforced by buildPaneRoute and surfaces in any action that would exceed
// it (toast + no-op).
export default function PaneTabBar({
  tabs,
  focusedPaneId,
  onFocus,
  onClose,
}: PaneTabBarProps) {
  if (tabs.length <= 1) return null;

  return (
    <div
      role="tablist"
      className="flex items-center gap-0.5 overflow-x-auto border-b border-border bg-muted/20 px-2 py-1 text-xs"
    >
      {tabs.map((tab) => {
        const isActive = tab.paneId === focusedPaneId;
        return (
          <button
            key={tab.paneId}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={(e) => {
              if (e.shiftKey && onClose) {
                onClose(tab.paneId);
                return;
              }
              onFocus(tab.paneId);
            }}
            className={`group flex max-w-[200px] items-center gap-1.5 rounded-md px-2 py-1 transition-colors ${
              isActive
                ? 'bg-background font-medium text-foreground shadow-sm'
                : 'text-muted-foreground hover:bg-background/60 hover:text-foreground'
            }`}
            title={tab.subLabel ? `${tab.label} — ${tab.subLabel}` : tab.label}
          >
            <span className="truncate">{tab.label}</span>
            {onClose && (
              <span
                role="button"
                tabIndex={0}
                aria-label={`Close pane ${tab.label}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onClose(tab.paneId);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.stopPropagation();
                    onClose(tab.paneId);
                  }
                }}
                className="rounded-sm p-0.5 opacity-0 transition-opacity hover:bg-muted group-hover:opacity-100 data-[active=true]:opacity-100"
                data-active={isActive}
              >
                <X className="h-3 w-3" aria-hidden="true" />
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
