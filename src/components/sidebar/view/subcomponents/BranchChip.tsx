import { GitBranch, Home } from 'lucide-react';
import { cn } from '../../../../lib/utils';
import { branchChipColorIndex } from '../../utils/repoAggregates';

const PALETTE = [
  'bg-green-50  text-green-600  dark:bg-green-900/30  dark:text-green-400  border-green-200  dark:border-green-900/40',
  'bg-blue-50   text-blue-600   dark:bg-blue-900/30   dark:text-blue-400   border-blue-200   dark:border-blue-900/40',
  'bg-purple-50 text-purple-600 dark:bg-purple-900/30 dark:text-purple-400 border-purple-200 dark:border-purple-900/40',
  'bg-amber-50  text-amber-700  dark:bg-amber-900/30  dark:text-amber-400  border-amber-200  dark:border-amber-900/40',
  'bg-pink-50   text-pink-600   dark:bg-pink-900/30   dark:text-pink-400   border-pink-200   dark:border-pink-900/40',
];

const NEUTRAL =
  'bg-muted text-muted-foreground border-border';

type BranchChipProps = {
  branchName?: string | null;
  /** When true, the chip reads as "the current/checked-out branch" — slightly bolder. */
  emphasized?: boolean;
  /** Distinguish a session/branch in the main repo checkout from one in a linked worktree. */
  origin?: 'main' | 'worktree';
  className?: string;
};

export default function BranchChip({ branchName, emphasized, origin = 'worktree', className }: BranchChipProps) {
  if (!branchName) {
    return null;
  }

  const palette = PALETTE[branchChipColorIndex(branchName)];
  const Icon = origin === 'main' ? Home : GitBranch;

  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] leading-none font-medium',
        palette ?? NEUTRAL,
        emphasized && 'font-semibold',
        className,
      )}
      title={branchName}
    >
      <Icon className="h-2.5 w-2.5" />
      <span className="truncate max-w-[140px]">{branchName}</span>
    </span>
  );
}
