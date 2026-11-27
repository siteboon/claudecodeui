import type { ReactNode } from 'react';

type SidebarSectionHeaderProps = {
  label: string;
  count?: number;
  /** A short amber call-out beside the count, such as "1 needs reply". */
  note?: string;
  /** An optional control on the right, such as the Projects section's add button. */
  action?: ReactNode;
};

/** The quiet label above each sidebar list (Active, Pinned, Projects, Recent conversations). */
export default function SidebarSectionHeader({ label, count, note, action }: SidebarSectionHeaderProps) {
  return (
    <div className="flex h-7 items-center gap-1.5 px-2.5">
      <h3 className="text-xs font-medium text-muted-foreground">{label}</h3>
      {count !== undefined && <span className="text-xs tabular-nums text-muted-foreground/60">{count}</span>}
      {note && (
        <span className="ml-1 flex items-center gap-1.5 text-xs font-medium text-amber-600 dark:text-amber-400">
          <span className="h-1.5 w-1.5 rounded-full bg-amber-500" aria-hidden="true" />
          {note}
        </span>
      )}
      {action && <div className="ml-auto flex items-center">{action}</div>}
    </div>
  );
}
