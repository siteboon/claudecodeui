import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';

import type { ChatMessage } from '@/shared/types';
import {
  describeWorkflowAgent,
  findCurrentWorkflowAgent,
  listRunningBackgroundLaunches,
  readBackgroundTaskId,
} from '@/modules/chat/utils/backgroundTasks';
import { parseToolPayload } from '@/modules/chat/utils/messageTransforms';

type BackgroundTasksStripProps = {
  /** The whole session, not the visible window: a task launched pages ago is still running. */
  messages: ChatMessage[];
  /** The session the tasks belong to, which `chat.stop-task` names; null before one exists. */
  sessionId: string | null;
  /** The chat websocket's send, for stopping a task. */
  sendMessage: (message: unknown) => void;
  /**
   * Brings a row into view. Owned by the pane's session state because the
   * row may sit outside the visible window or in an unmounted lazy row, so
   * it takes more than an element lookup to reach it.
   */
  onReveal: (message: ChatMessage) => void;
};

/** The one-line description the launch was given, as the card reads it. */
function readLaunchDescription(message: ChatMessage): string {
  if (message.workflow?.description) {
    return message.workflow.description;
  }
  const input = parseToolPayload(message.toolInput);
  const description = input && typeof input === 'object' ? (input as { description?: unknown }).description : undefined;
  return typeof description === 'string' ? description : '';
}

/** What one running task's chip says: its kind, its name, and how far it has got. */
function describeTask(message: ChatMessage, t: (key: string, defaultValue: string, options?: Record<string, unknown>) => string) {
  const live = message.taskStatus;
  const name = message.toolName === 'Workflow'
    ? message.workflow?.name || live?.workflowName || ''
    : message.subagent?.description || live?.description || '';
  const kind = message.toolName === 'Workflow'
    ? t('workflow.title', 'Workflow')
    : message.toolName === 'Bash'
      ? t('workflow.backgroundCommand', 'Command')
      : t('workflow.backgroundAgent', 'Agent');

  // A workflow reports on each agent it spawned — "2/6 agents · audit:sidebar"
  // says how many have finished and the one it is on. Short of that, its own
  // summary, unless it merely restates the launch's description (a workflow's
  // progress opens with it) or the chip's name — that says nothing new and it
  // is long. An agent reports only what it has spent. The history-loaded agent
  // counts stand in for a workflow the live stream has not described yet.
  let agentsProgress = '';
  if (live?.agents?.length) {
    const finished = live.agents.filter((agent) => agent.state === 'done' || agent.state === 'failed').length;
    const current = findCurrentWorkflowAgent(live.agents);
    agentsProgress = t('workflow.agentsProgress', '{{finished}}/{{total}} agents', { finished, total: live.agents.length });
    if (current) {
      agentsProgress += ` · ${describeWorkflowAgent(current)}`;
    }
  }
  const description = readLaunchDescription(message);
  const summary = live?.summary && live.summary !== description && live.summary !== name ? live.summary : '';
  const progress = agentsProgress
    || summary
    || (live?.usage ? `${live.usage.toolUses} ${live.usage.toolUses === 1 ? 'tool' : 'tools'}` : '')
    || (message.workflow && message.workflow.agentCounts.total > 0
      ? `${message.workflow.agentCounts.completed + message.workflow.agentCounts.failed}/${message.workflow.agentCounts.total}`
      : '');

  return { kind, name, progress };
}

/**
 * Rendered by chat's ChatMessagesPane above the transcript: one chip per
 * background task — workflow, agent or command — that is still running, each
 * scrolling to its card when clicked and stoppable from its ✕. Renders
 * nothing while nothing runs, which is most of the time.
 */
export const BackgroundTasksStrip = memo(({ messages, sessionId, sendMessage, onReveal }: BackgroundTasksStripProps) => {
  const { t } = useTranslation();
  const running = listRunningBackgroundLaunches(messages);

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
        const taskId = readBackgroundTaskId(message);
        const title = [kind, name, progress].filter(Boolean).join(' · ');
        return (
          <span key={message.toolId} className="flex min-w-0 max-w-full items-center">
            <button
              type="button"
              onClick={() => onReveal(message)}
              title={title}
              className="flex min-w-0 max-w-xs items-center gap-1.5 rounded px-1.5 py-0.5 hover:bg-muted hover:text-foreground"
            >
              <span className="h-1.5 w-1.5 flex-shrink-0 animate-pulse rounded-full bg-purple-500 dark:bg-purple-400" />
              <span className="flex-shrink-0 font-medium text-foreground">{kind}</span>
              {name && <span className="min-w-0 truncate">{name}</span>}
              {progress && <span className="min-w-0 truncate text-muted-foreground/70">· {progress}</span>}
            </button>
            {sessionId && taskId && (
              <button
                type="button"
                onClick={() => sendMessage({ type: 'chat.stop-task', sessionId, taskId })}
                aria-label={t('workflow.stopTask', 'Stop')}
                title={t('workflow.stopTask', 'Stop')}
                className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded text-muted-foreground/60 hover:bg-muted hover:text-destructive"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </span>
        );
      })}
    </div>
  );
});
BackgroundTasksStrip.displayName = 'BackgroundTasksStrip';
