import { memo } from 'react';
import {
  AlertCircle,
  ArrowRight,
  CheckCircle,
  ChevronUp,
  Circle,
  Clock,
  Minus,
  Pause,
  X,
} from 'lucide-react';
import { cn } from '../../../lib/utils';
import { Tooltip } from '../../../shared/view/ui';
import type { TaskMasterTask } from '../types';

type TaskCardProps = {
  task: TaskMasterTask;
  onClick?: (() => void) | null;
  showParent?: boolean;
  className?: string;
};

type TaskStatusStyle = {
  icon: typeof Circle;
  statusText: string;
  iconColor: string;
  textColor: string;
};

function getStatusStyle(status?: string): TaskStatusStyle {
  if (status === 'done') {
    return {
      icon: CheckCircle,
      statusText: 'Done',
      iconColor: 'text-green-600 dark:text-green-400',
      textColor: 'text-green-900 dark:text-green-100',
    };
  }

  if (status === 'in-progress') {
    return {
      icon: Clock,
      statusText: 'In Progress',
      iconColor: 'text-blue-600 dark:text-blue-400',
      textColor: 'text-blue-900 dark:text-blue-100',
    };
  }

  if (status === 'review') {
    return {
      icon: AlertCircle,
      statusText: 'Review',
      iconColor: 'text-amber-600 dark:text-amber-400',
      textColor: 'text-amber-900 dark:text-amber-100',
    };
  }

  if (status === 'deferred') {
    return {
      icon: Pause,
      statusText: 'Deferred',
      iconColor: 'text-gray-500 dark:text-gray-400',
      textColor: 'text-gray-700 dark:text-gray-300',
    };
  }

  if (status === 'cancelled') {
    return {
      icon: X,
      statusText: 'Cancelled',
      iconColor: 'text-red-600 dark:text-red-400',
      textColor: 'text-red-900 dark:text-red-100',
    };
  }

  return {
    icon: Circle,
    statusText: 'Pending',
    iconColor: 'text-slate-500 dark:text-slate-400',
    textColor: 'text-slate-900 dark:text-slate-100',
  };
}

function renderPriorityIcon(priority?: string) {
  if (priority === 'high') {
    return (
      <Tooltip content="High priority">
        <div className="flex h-4 w-4 items-center justify-center rounded bg-red-100 dark:bg-red-900/30">
          <ChevronUp className="h-2.5 w-2.5 text-red-600 dark:text-red-400" />
        </div>
      </Tooltip>
    );
  }

  if (priority === 'medium') {
    return (
      <Tooltip content="Medium priority">
        <div className="flex h-4 w-4 items-center justify-center rounded bg-amber-100 dark:bg-amber-900/30">
          <Minus className="h-2.5 w-2.5 text-amber-600 dark:text-amber-400" />
        </div>
      </Tooltip>
    );
  }

  if (priority === 'low') {
    return (
      <Tooltip content="Low priority">
        <div className="flex h-4 w-4 items-center justify-center rounded bg-blue-100 dark:bg-blue-900/30">
          <Circle className="h-1.5 w-1.5 fill-current text-blue-600 dark:text-blue-400" />
        </div>
      </Tooltip>
    );
  }

  return (
    <Tooltip content="No priority set">
      <div className="flex h-4 w-4 items-center justify-center rounded bg-gray-100 dark:bg-gray-800">
        <Circle className="h-1.5 w-1.5 text-gray-400 dark:text-gray-500" />
      </div>
    </Tooltip>
  );
}

function getSubtaskProgress(task: TaskMasterTask): { completed: number; total: number; percentage: number } {
  const subtasks = task.subtasks ?? [];
  const total = subtasks.length;
  const completed = subtasks.filter((subtask) => subtask.status === 'done').length;
  const percentage = total > 0 ? Math.round((completed / total) * 100) : 0;

  return { completed, total, percentage };
}

function TaskCard({ task, onClick = null, showParent = false, className = '' }: TaskCardProps) {
  const statusStyle = getStatusStyle(task.status);
  const progress = getSubtaskProgress(task);

  return (
    <div
      className={cn(
        'bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-3 space-y-3',
        'hover:shadow-md hover:border-blue-300 dark:hover:border-blue-600 transition-all duration-200',
        onClick ? 'cursor-pointer hover:-translate-y-0.5' : 'cursor-default',
        className,
      )}
      onClick={onClick ?? undefined}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex items-center gap-2">
            <Tooltip content={`Task ID: ${task.id}`}>
              <span className="rounded bg-gray-100 px-2 py-0.5 font-mono text-xs text-gray-500 dark:bg-gray-700 dark:text-gray-400">
                {task.id}
              </span>
            </Tooltip>
          </div>

          <h3 className="line-clamp-2 text-sm font-medium leading-tight text-gray-900 dark:text-white">
            {task.title}
          </h3>

          {showParent && task.parentId && (
            <span className="text-xs font-medium text-gray-500 dark:text-gray-400">Task {task.parentId}</span>
          )}
        </div>

        <div className="flex-shrink-0">{renderPriorityIcon(task.priority)}</div>
      </div>

      <div className="flex items-center justify-between">
        <div className="flex items-center">
          {Array.isArray(task.dependencies) && task.dependencies.length > 0 && (
            <Tooltip content={`Depends on: ${task.dependencies.map((dependency) => `Task ${dependency}`).join(', ')}`}>
              <div className="flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400">
                <ArrowRight className="h-3 w-3" />
                <span>Depends on: {task.dependencies.join(', ')}</span>
              </div>
            </Tooltip>
          )}
        </div>

        <Tooltip content={`Status: ${statusStyle.statusText}`}>
          <div className="flex items-center gap-1">
            <div className={cn('w-2 h-2 rounded-full', statusStyle.iconColor.replace('text-', 'bg-'))} />
            <span className={cn('text-xs font-medium', statusStyle.textColor)}>{statusStyle.statusText}</span>
          </div>
        </Tooltip>
      </div>

      {progress.total > 0 && (
        <div className="ml-3">
          <div className="mb-1 flex items-center gap-2">
            <span className="text-xs text-gray-500 dark:text-gray-400">Progress:</span>
            <div className="h-1.5 flex-1 rounded-full bg-gray-200 dark:bg-gray-700" title={`${progress.completed} of ${progress.total} subtasks completed`}>
              <div
                className={cn('h-full rounded-full transition-all duration-300', task.status === 'done' ? 'bg-green-500' : 'bg-blue-500')}
                style={{ width: `${progress.percentage}%` }}
              />
            </div>
            <span className="text-xs text-gray-500 dark:text-gray-400">
              {progress.completed}/{progress.total}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

export default memo(TaskCard);
