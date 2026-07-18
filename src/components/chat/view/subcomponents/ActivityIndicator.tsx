import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Shimmer } from '../../../../shared/view/ui';
import type { SessionActivity } from '../../../../hooks/useSessionProtection';

type ActivityIndicatorProps = {
  activity: SessionActivity | null;
  onAbort?: () => void;
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

/**
 * Inline activity status bar rendered inside the PromptInput header.
 * Shows a shimmering activity label with elapsed time on the left,
 * and an optional interrupt (Stop) button on the right.
 */
export default function ActivityIndicator({ activity, onAbort }: ActivityIndicatorProps) {
  const { t } = useTranslation('chat');
  const startedAt = activity?.startedAt ?? null;
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  useEffect(() => {
    if (startedAt === null) return;
    const update = () => setElapsedSeconds(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)));
    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [startedAt]);

  if (!activity) return null;

  const actionWords = ACTION_KEYS.map((key, i) => t(key, { defaultValue: DEFAULT_ACTION_WORDS[i] }));
  const label = (activity.statusText || actionWords[Math.floor(elapsedSeconds / 4) % actionWords.length])
    .replace(/\.+$/, '');

  const minutes = Math.floor(elapsedSeconds / 60);
  const seconds = elapsedSeconds % 60;
  const elapsedLabel = minutes < 1
    ? t('claudeStatus.elapsed.seconds', { count: seconds, defaultValue: '{{count}}s' })
    : t('claudeStatus.elapsed.minutesSeconds', { minutes, seconds, defaultValue: '{{minutes}}m {{seconds}}s' });

  return (
    <div className="flex items-center justify-between px-3 pt-2.5 pb-1">
      <div className="flex items-center gap-2">
        <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-primary" aria-hidden />
        <Shimmer className="text-xs font-medium">{`${label}…`}</Shimmer>
        <span className="text-xs tabular-nums text-muted-foreground/60">{elapsedLabel}</span>
      </div>

      {activity.canInterrupt && onAbort && (
        <button
          type="button"
          onClick={onAbort}
          className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
          aria-label={t('claudeStatus.stop', { defaultValue: 'Stop' })}
        >
          <svg className="h-3 w-3 fill-current" viewBox="0 0 24 24" aria-hidden>
            <rect x="5" y="5" width="14" height="14" rx="2" />
          </svg>
          <span>{t('claudeStatus.stop', { defaultValue: 'Stop' })}</span>
        </button>
      )}
    </div>
  );
}
