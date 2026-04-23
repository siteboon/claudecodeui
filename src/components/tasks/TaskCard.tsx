import { memo } from 'react';
import { CheckCircle, Clock, Circle } from 'lucide-react';

export type TaskCardData = {
  content: string;
  activeForm: string;
  status: 'pending' | 'in_progress' | 'completed';
};

type TaskCardProps = {
  task: TaskCardData;
  accent?: 'mint' | 'sky' | 'lavender' | 'butter' | 'blush' | 'peach';
  updatedAt?: string | null;
};

function formatUpdatedAt(updatedAt?: string | null): string | null {
  if (!updatedAt) return null;
  try {
    const d = new Date(updatedAt);
    if (Number.isNaN(d.getTime())) return null;
    return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  } catch {
    return null;
  }
}

function iconFor(status: TaskCardData['status']) {
  if (status === 'completed') return CheckCircle;
  if (status === 'in_progress') return Clock;
  return Circle;
}

function iconTint(status: TaskCardData['status']): string {
  if (status === 'completed') return 'text-mint';
  if (status === 'in_progress') return 'text-sky';
  return 'text-midnight-text3';
}

function TaskCardImpl({ task, accent = 'lavender', updatedAt }: TaskCardProps) {
  const Icon = iconFor(task.status);
  const timeLabel = formatUpdatedAt(updatedAt);
  const title = task.status === 'in_progress' && task.activeForm ? task.activeForm : task.content;
  return (
    <article
      data-accent={accent}
      className="ds-tile ds-tile-hover mobile-touch-target flex items-start gap-3 p-4"
    >
      <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${iconTint(task.status)}`} aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-midnight-text">
          {title}
        </div>
        {timeLabel && (
          <div className="mt-1 text-xs tabular-nums text-midnight-text3">
            Updated {timeLabel}
          </div>
        )}
      </div>
    </article>
  );
}

export default memo(TaskCardImpl);
