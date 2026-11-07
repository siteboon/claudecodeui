import type { ComponentPropsWithoutRef, ReactNode } from 'react';

import { cn } from '@/shared/utils';

/* ── Container ─────────────────────────────────────────────────── */
type PillBarProps = ComponentPropsWithoutRef<'div'> & {
  children: ReactNode;
};

/** Used by the project-workspace and settings modules as the horizontal tab strip. */
export function PillBar({ children, className, ...props }: PillBarProps) {
  return (
    <div
      className={cn('inline-flex items-center gap-[2px] rounded-lg bg-muted/60 p-[3px]', className)}
      {...props}
    >
      {children}
    </div>
  );
}

/* ── Individual pill button ────────────────────────────────────── */
type PillProps = Omit<ComponentPropsWithoutRef<'button'>, 'onClick'> & {
  isActive: boolean;
  onClick: () => void;
  children: ReactNode;
};

/** A single tab inside PillBar, used by the project-workspace and settings modules. */
export function Pill({ isActive, onClick, children, className, ...props }: PillProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex shrink-0 touch-manipulation items-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium outline-none transition-all duration-150 focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-1 focus-visible:ring-offset-muted',
        isActive
          ? 'bg-background text-foreground shadow-sm ring-1 ring-border/50'
          : 'text-muted-foreground hover:bg-background/50 hover:text-foreground active:bg-background/70',
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}
