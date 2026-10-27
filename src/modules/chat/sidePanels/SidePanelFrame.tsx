import type { ReactNode } from 'react';

import { cn } from '@/shared/utils';

/** One panel's tab in the frame's tab row. */
type SidePanelTab = {
  id: string;
  label: string;
  /** A count drawn beside the label, such as the agents running. */
  badge?: number;
  active: boolean;
  onSelect: () => void;
};

type SidePanelFrameProps = {
  /** The tab row, shown only while more than one panel is open; null hides it. */
  tabs: SidePanelTab[] | null;
  children: ReactNode;
};

/**
 * Rendered by ChatInterface for the area right of the transcript, which the
 * agents panel and the /btw side chat share: beside the chat from the `lg`
 * width, over it below that. With both open, a tab row picks the one in
 * front; the other stays mounted behind it, so its draft and scroll survive.
 */
export default function SidePanelFrame({ tabs, children }: SidePanelFrameProps) {
  return (
    <aside className="fixed inset-0 z-40 flex flex-col bg-background lg:static lg:z-auto lg:w-[400px] lg:shrink-0 lg:border-l lg:border-border xl:w-[440px]">
      {tabs && (
        <div role="tablist" className="flex shrink-0 gap-1 border-b border-border px-2 pt-1.5">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={tab.active}
              onClick={tab.onSelect}
              className={cn(
                '-mb-px flex items-center gap-1.5 border-b-2 px-3 py-1.5 text-xs font-medium transition-colors',
                tab.active
                  ? 'border-foreground text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              {tab.label}
              {Boolean(tab.badge) && (
                <span className="rounded-full bg-purple-500/15 px-1.5 text-[10px] tabular-nums text-purple-700 dark:text-purple-300">
                  {tab.badge}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
      {children}
    </aside>
  );
}
