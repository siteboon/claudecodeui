import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { CircleCheck, CircleDashed, Loader } from 'lucide-react';

import { cn } from '@/shared/utils';
import type { SessionTask } from '@/modules/chat/utils/sessionTaskList';

type TasksSectionProps = {
  tasks: SessionTask[];
};

/**
 * The task ledger the agent committed to this session, rebuilt from the
 * transcript by buildSessionTaskLedger. An in-progress row shows the
 * present-tense wording (activeForm) the agent created it with, which reads
 * better than the imperative subject while the work is actually happening.
 */
export const TasksSection = memo(({ tasks }: TasksSectionProps) => {
  const { t } = useTranslation('chat');

  if (tasks.length === 0) {
    return <div className="py-1 text-xs text-muted-foreground">{t('sessionInfoPanel.empty')}</div>;
  }

  return (
    <ul className="space-y-1 py-0.5">
      {tasks.map((task) => (
        <li key={task.id} className="flex items-start gap-1.5 text-xs">
          {task.status === 'completed' ? (
            <CircleCheck className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-green-500" />
          ) : task.status === 'in_progress' ? (
            <Loader className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 animate-spin text-primary" />
          ) : (
            <CircleDashed className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-muted-foreground/60" />
          )}
          <span
            className={cn(
              'min-w-0 flex-1 leading-snug',
              task.status === 'completed' ? 'text-muted-foreground line-through' : 'text-foreground/90',
            )}
            title={task.content}
          >
            {task.status === 'in_progress' && task.activeForm ? task.activeForm : task.content}
          </span>
        </li>
      ))}
    </ul>
  );
});
TasksSection.displayName = 'TasksSection';
