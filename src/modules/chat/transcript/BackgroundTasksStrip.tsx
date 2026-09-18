import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import type { ChatMessage } from '@/shared/types';
import { readBackgroundTaskStatus } from '@/modules/chat/utils/backgroundTasks';

type BackgroundTasksStripProps = {
  /** The whole session, not the visible window: a task launched pages ago is still running. */
  messages: ChatMessage[];
  /**
   * Brings a row into view. Owned by the pane's session state because the
   * row may sit outside the visible window or in an unmounted lazy row, so
   * it takes more than an element lookup to reach it.
   */
  onReveal: (message: ChatMessage) => void;
};

/** What one running task's chip says: its kind, its name, and how far it has got. */
function describeTask(message: ChatMessage, t: (key: string, defaultValue: string) => string) {
  const live = message.taskStatus;
  const name = message.toolName === 'Workflow'
    ? message.workflow?.name || live?.workflowName || ''
    : message.subagent?.description || live?.description || '';
  const kind = message.toolName === 'Workflow'
    ? t('workflow.title', 'Workflow')
    : message.toolName === 'Bash'
      ? t('workflow.backgroundCommand', 'Command')
      : t('workflow.backgroundAgent', 'Agent');

  // A workflow reports its phase and step ("Verify 3/6"); an agent only what
  // it has spent. The history-loaded agent counts stand in for a workflow
  // the live stream has not described yet.
  const progress = live?.summary
    || (live?.usage ? `${live.usage.toolUses} ${live.usage.toolUses === 1 ? 'tool' : 'tools'}` : '')
    || (message.workflow && message.workflow.agentCounts.total > 0
      ? `${message.workflow.agentCounts.completed + message.workflow.agentCounts.failed}/${message.workflow.agentCounts.total}`
      : '');

  return { kind, name, progress };
}

/**
 * Rendered by chat's ChatMessagesPane above the transcript: one chip per
 * background task — workflow, agent or command — that is still running, each
 * scrolling to its card when clicked. Renders nothing while nothing runs,
 * which is most of the time.
 */
export const BackgroundTasksStrip = memo(({ messages, onReveal }: BackgroundTasksStripProps) => {
  const { t } = useTranslation();
  const running = messages.filter(
    (message) => message.isToolUse && message.toolId && readBackgroundTaskStatus(message) === 'running',
  );

  if (running.length === 0) {
    return null;
  }

  return (
    <div
      role="status"
      aria-label={t('workflow.backgroundTasks', 'Background tasks')}
      className="flex max-w-full flex-wrap items-center gap-1.5 rounded-md border border-border/60 bg-background/95 px-2 py-1 text-[11px] text-muted-foreground shadow-sm backdrop-blur"
    >
      {running.map((message) => {
        const { kind, name, progress } = describeTask(message, t);
        return (
          <button
            key={message.toolId}
            type="button"
            onClick={() => onReveal(message)}
            className="flex max-w-xs items-center gap-1.5 rounded px-1.5 py-0.5 hover:bg-muted hover:text-foreground"
          >
            <span className="h-1.5 w-1.5 flex-shrink-0 animate-pulse rounded-full bg-purple-500 dark:bg-purple-400" />
            <span className="flex-shrink-0 font-medium text-foreground">{kind}</span>
            {name && <span className="min-w-0 truncate">{name}</span>}
            {progress && <span className="flex-shrink-0 text-muted-foreground/70">· {progress}</span>}
          </button>
        );
      })}
    </div>
  );
});
BackgroundTasksStrip.displayName = 'BackgroundTasksStrip';
