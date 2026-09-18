import { memo } from 'react';
import { GaugeIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useAccountRateLimit } from '@/modules/chat/hooks/useAccountRateLimit';
import {
  busiestRateLimitWindow,
  formatResetsIn,
  rateLimitPercent,
  rateLimitTone,
  rateLimitWindowLabel,
  sortRateLimitWindows,
} from '@/modules/chat/utils/rateLimit';

type RateLimitSummaryProps = {
  onClick?: () => void;
};

/**
 * The account's subscription quota, beside the session's token budget.
 *
 * The two sit next to each other and mean different things — this one is how
 * much of the account's five-hour and weekly allowance is gone, the other is
 * how full this session's context window is — so this one names its windows
 * ("5h", "7d") and the tooltip says "account" out loud.
 *
 * Renders nothing until a run reports a quota: the SDK sends it only when it
 * changes, so an untouched session has no value to show and an empty gauge
 * would read as "0% used".
 */
function RateLimitSummary({ onClick }: RateLimitSummaryProps) {
  const { t } = useTranslation();
  const info = useAccountRateLimit();
  const windows = info ? sortRateLimitWindows(info.windows) : [];
  const busiest = busiestRateLimitWindow(info);

  if (!info || windows.length === 0 || !busiest) {
    return null;
  }

  const isRejected = info.status === 'rejected';
  const usingOverage = info.overage?.inUse === true;
  const detail = windows
    .map((window) => {
      const percent = rateLimitPercent(window.utilization);
      const resets = formatResetsIn(window.resetsAt);
      return resets
        ? `${rateLimitWindowLabel(window.type)} ${percent}% (${resets})`
        : `${rateLimitWindowLabel(window.type)} ${percent}%`;
    })
    .join(' · ');
  const title = [
    `${t('chat:misc.accountQuota')}: ${detail}`,
    usingOverage ? t('chat:misc.quotaOverage') : null,
    isRejected ? t('chat:misc.quotaRejected') : null,
  ].filter(Boolean).join(' — ');

  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border/70 bg-background/70 px-2 text-xs text-muted-foreground shadow-sm transition-colors hover:border-primary/25 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:gap-2 sm:px-2.5"
      title={title}
      aria-label={t('chat:misc.showAccountQuota')}
    >
      <span className={`grid h-5 w-5 place-items-center rounded-md ${isRejected ? 'bg-red-500/15 text-red-500' : 'bg-primary/10 text-primary'}`}>
        <GaugeIcon className="h-3.5 w-3.5" />
      </span>
      {windows.map((window) => {
        const percent = rateLimitPercent(window.utilization);
        // Every window is listed where there is room; phone width keeps only
        // the one closest to full, which is the one that will bite first.
        const visibility = window.type === busiest.type ? 'inline' : 'hidden sm:inline';

        return (
          <span key={window.type} className={`${visibility} whitespace-nowrap`}>
            <span className="text-muted-foreground/70">{rateLimitWindowLabel(window.type)} </span>
            <span className={`font-medium ${rateLimitTone(percent, info.status)}`}>{percent}%</span>
          </span>
        );
      })}
      {usingOverage && (
        <span className="hidden rounded bg-amber-500/15 px-1 font-medium text-amber-600 dark:text-amber-400 sm:inline">
          {t('chat:misc.quotaOverageShort')}
        </span>
      )}
    </button>
  );
}

/** Memoized for the same reason as the token counter: the composer re-renders on every keystroke, this number moves once in a while. */
export default memo(RateLimitSummary);
