import { cn } from '../../../../lib/utils';

export type ToolStatus =
  | 'running'
  | 'completed'
  | 'error'
  | 'denied'
  | 'pending'
  | 'applied'
  | 'reverted'
  | 'failed';

const STATUS_CONFIG: Record<ToolStatus, { label: string; className: string }> = {
  running: {
    label: 'Running',
    className: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  },
  completed: {
    label: 'Completed',
    className: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
  },
  error: {
    label: 'Error',
    className: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
  },
  denied: {
    label: 'Denied',
    className: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300',
  },
  pending: {
    label: 'Pending',
    className: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300',
  },
  applied: {
    label: 'Applied',
    className: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
  },
  reverted: {
    label: 'Reverted',
    className: 'bg-gray-100 text-gray-600 dark:bg-gray-800/30 dark:text-gray-400',
  },
  failed: {
    label: 'Failed',
    className: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
  },
};

interface ToolStatusBadgeProps {
  status: ToolStatus;
  className?: string;
}

export function ToolStatusBadge({ status, className }: ToolStatusBadgeProps) {
  const config = STATUS_CONFIG[status];
  return (
    <span
      className={cn(
        'inline-flex items-center rounded px-1.5 py-px text-[10px] font-medium',
        config.className,
        className,
      )}
    >
      {config.label}
    </span>
  );
}
