import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';

import { Shimmer } from '@/shared/ui';
import type { BackgroundTaskSummary, SessionActivity } from '@/shared/types';

type ActivityIndicatorProps = {
  activity: SessionActivity | null;
  onAbort?: () => void;
  isInputFocused?: boolean;
};

const ACTION_KEYS = [
  'claudeStatus.actions.thinking',
  'claudeStatus.actions.processing',
  'claudeStatus.actions.analyzing',
  'claudeStatus.actions.working',
  'claudeStatus.actions.computing',
  'claudeStatus.actions.reasoning',
];
const DEFAULT_ACTION_WORDS = ['Thinking', 'Processing', 'Analyzing', 'Working', 'Computing', 'Reasoning'];
const EXIT_ANIMATION_MS = 220;

/** What the background work is: the one task by kind and name, or how many when there are several. */
function describeBackgroundTasks(allTasks: BackgroundTaskSummary[], t: TFunction): string {
  // A workflow agent's own backgrounded commands are listed too (so they can be
  // stopped), but they are that agent's business; the session's work is the
  // workflow. Only when nothing but nested tasks remain are they what is running.
  const own = allTasks.filter((task) => !task.nested);
  const tasks = own.length > 0 ? own : allTasks;
  if (tasks.length !== 1) {
    return t('claudeStatus.backgroundTask.count', { count: tasks.length, defaultValue: '{{count}} tasks' });
  }
  const [task] = tasks;
  switch (task.taskType) {
    case 'local_workflow':
      return t('claudeStatus.backgroundTask.workflow', { name: task.workflowName ?? task.description, defaultValue: 'Workflow {{name}}' });
    case 'local_bash':
      return t('claudeStatus.backgroundTask.command', { description: task.description, defaultValue: 'Command {{description}}' });
    default:
      return t('claudeStatus.backgroundTask.agent', { description: task.description, defaultValue: 'Agent {{description}}' });
  }
}

/**
 * Minimal response-in-progress indicator, in the spirit of the inline status
 * lines in Claude Code / Codex / OpenCode: a shimmering activity label, the
 * elapsed time, and an interrupt affordance. Rendered only while the viewed
 * session has an entry in the processing map; it disappears the instant that
 * entry is removed.
 *
 * A session whose turn has ended while the tasks it launched still run is
 * drawn in the workflow and agent cards' purple, naming the work, and with no
 * Stop: nothing is responding, and the composer can send.
 *
 * Rendered by chat's ChatComposer above the input so the user can see and
 * interrupt the in-flight turn without leaving the composer.
 */
export default function ActivityIndicator({ activity, onAbort, isInputFocused = false }: ActivityIndicatorProps) {
  const { t } = useTranslation('chat');
  const [renderedActivity, setRenderedActivity] = useState<SessionActivity | null>(activity);
  const [isExiting, setIsExiting] = useState(false);
  const startedAt = renderedActivity?.startedAt ?? null;
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  useEffect(() => {
    if (activity) {
      setRenderedActivity(activity);
      setIsExiting(false);
      return;
    }

    if (!renderedActivity) return;

    setIsExiting(true);
    const timer = setTimeout(() => {
      setRenderedActivity(null);
      setIsExiting(false);
    }, EXIT_ANIMATION_MS);

    return () => clearTimeout(timer);
  }, [activity, renderedActivity]);

  useEffect(() => {
    if (startedAt === null) return;
    const update = () => setElapsedSeconds(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)));
    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [startedAt]);

  if (!renderedActivity) return null;

  const isBackground = Boolean(renderedActivity.background);
  const actionWords = ACTION_KEYS.map((key, i) => t(key, { defaultValue: DEFAULT_ACTION_WORDS[i] }));
  const label = isBackground
    ? t('claudeStatus.backgroundWork', 'Background work')
    : (renderedActivity.statusText || actionWords[Math.floor(elapsedSeconds / 4) % actionWords.length])
      .replace(/\.+$/, '');
  const detail = isBackground ? describeBackgroundTasks(renderedActivity.tasks ?? [], t) : '';

  const minutes = Math.floor(elapsedSeconds / 60);
  const seconds = elapsedSeconds % 60;
  const elapsedLabel = minutes < 1
    ? t('claudeStatus.elapsed.seconds', { count: seconds, defaultValue: '{{count}}s' })
    : t('claudeStatus.elapsed.minutesSeconds', { minutes, seconds, defaultValue: '{{minutes}}m {{seconds}}s' });
  const tabSurfaceClassName = [
    'chat-activity-tab inline-flex h-8 items-center rounded-b-none rounded-t-lg border border-b-0 bg-card px-3 text-xs transition-all duration-200',
    isInputFocused
      ? 'border-primary/30 shadow-[0_-1px_2px_hsl(var(--foreground)/0.08),1px_0_2px_hsl(var(--foreground)/0.06),-1px_0_2px_hsl(var(--foreground)/0.06)]'
      : 'border-border/50 shadow-[0_-1px_1px_hsl(var(--foreground)/0.04),1px_0_1px_hsl(var(--foreground)/0.03),-1px_0_1px_hsl(var(--foreground)/0.03)]',
  ].join(' ');

  return (
    <div
      className={`pointer-events-none bg-transparent ${
        isExiting ? 'chat-activity-exit' : 'chat-activity-enter'
      }`}
    >
      <div className="flex items-end justify-between gap-2">
        <div className={`${tabSurfaceClassName} min-w-0 max-w-full gap-2`}>
          <span
            className={`h-1.5 w-1.5 shrink-0 animate-pulse rounded-full ${
              isBackground ? 'bg-purple-500 dark:bg-purple-400' : 'bg-primary'
            }`}
            aria-hidden
          />
          <Shimmer className="shrink-0 font-medium">{`${label}…`}</Shimmer>
          {detail && (
            <span className="min-w-0 truncate text-muted-foreground" title={detail}>{detail}</span>
          )}
          <span className="shrink-0 tabular-nums text-muted-foreground/60">{elapsedLabel}</span>
        </div>

        {renderedActivity.canInterrupt && onAbort && (
          <button
            type="button"
            onClick={onAbort}
            className={`${tabSurfaceClassName} pointer-events-auto gap-1.5 text-muted-foreground hover:bg-card hover:text-destructive`}
            aria-label={t('claudeStatus.stop', { defaultValue: 'Stop' })}
          >
            <svg className="h-2.5 w-2.5 fill-current" viewBox="0 0 24 24" aria-hidden>
              <rect x="5" y="5" width="14" height="14" rx="2" />
            </svg>
            <span>{t('claudeStatus.stop', { defaultValue: 'Stop' })}</span>
            <kbd className="hidden rounded border border-border/60 px-1 text-[10px] text-muted-foreground/70 sm:inline-block">
              esc
            </kbd>
          </button>
        )}
      </div>
    </div>
  );
}
