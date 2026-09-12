import { memo, type ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';

import { cn } from '@/shared/utils';

type InfoSectionProps = {
  title: string;
  /** Small trailing label in the header row (a count, e.g. "3/5"). */
  countLabel?: string;
  collapsed: boolean;
  onToggle: () => void;
  children: ReactNode;
};

/**
 * One collapsible section of the session info panel: a header row (title,
 * optional count, rotating chevron) that mounts its body only while expanded
 * — the same rule SubagentPanel follows for long agent timelines.
 */
export const InfoSection = memo(({ title, countLabel, collapsed, onToggle, children }: InfoSectionProps) => (
  <section className="border-b border-border/40 last:border-b-0">
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={!collapsed}
      className="flex w-full items-center gap-1.5 px-3 py-2 text-left text-xs font-medium text-foreground/80 hover:bg-muted/40"
    >
      <ChevronRight className={cn('h-3 w-3 flex-shrink-0 text-muted-foreground transition-transform', !collapsed && 'rotate-90')} />
      <span className="min-w-0 flex-1 truncate">{title}</span>
      {countLabel && <span className="flex-shrink-0 text-[11px] text-muted-foreground">{countLabel}</span>}
    </button>
    {!collapsed && <div className="px-3 pb-2.5">{children}</div>}
  </section>
));
InfoSection.displayName = 'InfoSection';
