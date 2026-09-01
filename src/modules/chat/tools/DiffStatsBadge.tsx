import { cn } from '@/shared/utils';
import type { DiffStats } from '@/shared/types';

type DiffStatsBadgeProps = {
  stats: DiffStats;
  className?: string;
};

/**
 * `+12 -3` for a file edit, in the green/red pair the git panel already uses
 * for commit stats.
 *
 * Rendered by chat's ToolRenderer in the collapsible header of every Edit,
 * Write and ApplyPatch, and by ToolGroupContainer as the total for a collapsed
 * run of them — so the size of a change is readable without expanding it.
 *
 * A side with no lines is omitted rather than shown as `+0`: a new file reads
 * `+40`, and a deletion reads `-40`.
 */
export function DiffStatsBadge({ stats, className }: DiffStatsBadgeProps) {
  const { added, removed } = stats;

  // An edit whose replacement is identical to the original produces neither,
  // and `+0 -0` would be noise on a row that already says nothing changed.
  if (added === 0 && removed === 0) {
    return null;
  }

  return (
    <span
      className={cn('inline-flex items-center gap-1 font-mono text-[10px] tabular-nums', className)}
      aria-label={`${added} lines added, ${removed} removed`}
    >
      {added > 0 && <span className="text-green-600 dark:text-green-400">+{added}</span>}
      {removed > 0 && <span className="text-red-600 dark:text-red-400">-{removed}</span>}
    </span>
  );
}
