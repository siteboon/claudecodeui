import { memo } from 'react';
import { ActivityIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

type TokenUsageSummaryProps = {
  usage: Record<string, unknown> | null;
  onClick?: () => void;
};

const formatTokenCount = (value: number) => {
  if (!Number.isFinite(value) || value <= 0) {
    return '0';
  }

  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}M`;
  }

  if (value >= 10_000) {
    return `${Math.round(value / 1_000)}K`;
  }

  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(1)}K`;
  }

  return value.toLocaleString();
};

const readUsageNumber = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

/**
 * Rendered by chat's ChatComposer to show the session's context-window usage
 * and open the detailed token breakdown on click.
 */
function TokenUsageSummary({ usage, onClick }: TokenUsageSummaryProps) {
  const { t } = useTranslation();
  const breakdown =
    usage?.breakdown && typeof usage.breakdown === 'object'
      ? usage.breakdown as Record<string, unknown>
      : null;
  const inputTokens = readUsageNumber(usage?.inputTokens ?? breakdown?.input);
  const outputTokens = readUsageNumber(usage?.outputTokens ?? breakdown?.output);
  const usedTokens = readUsageNumber(usage?.used) || inputTokens + outputTokens;
  // The backend already reports the model's context window as `total`, but the
  // UI never rendered it — so a bare token count read as "session length" with
  // no sense of how close the context actually is to full.
  const contextWindow = readUsageNumber(usage?.total);
  const hasContextWindow = contextWindow > 0;
  const percentUsed = hasContextWindow
    ? Math.min(100, Math.round((usedTokens / contextWindow) * 100))
    : 0;
  const percentTone = percentUsed >= 90
    ? 'text-red-500'
    : percentUsed >= 75
      ? 'text-amber-500'
      : 'text-muted-foreground/70';
  const title = hasContextWindow
    ? t('chat:misc.tokensUsedOfContext', {
      used: usedTokens.toLocaleString(),
      total: contextWindow.toLocaleString(),
      percent: percentUsed,
    })
    : t('chat:misc.tokensUsed', { count: usedTokens });

  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border/70 bg-background/70 px-2 text-xs text-muted-foreground shadow-sm transition-colors hover:border-primary/25 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:gap-2 sm:px-2.5"
      title={title}
      aria-label={t('chat:misc.showTokenUsage')}
    >
      <span className="grid h-5 w-5 place-items-center rounded-md bg-primary/10 text-primary">
        <ActivityIcon className="h-3.5 w-3.5" />
      </span>
      {hasContextWindow ? (
        <>
          {/* Phone width keeps the percent and drops `used/total`: the percent is
              both the shortest form and the one that answers "how close to full",
              while the pair is the widest thing in the footer and what pushed the
              right-hand group onto a second row. */}
          <span className="hidden font-medium text-foreground sm:inline">{formatTokenCount(usedTokens)}</span>
          <span className="hidden text-muted-foreground/70 sm:inline">/{formatTokenCount(contextWindow)}</span>
          <span className={`font-medium ${percentTone}`}>{percentUsed}%</span>
        </>
      ) : (
        /* No window reported means no percent to fall back on, so the raw count
           stays on every width. */
        <>
          <span className="font-medium text-foreground">{formatTokenCount(usedTokens)}</span>
          <span className="hidden text-muted-foreground/70 sm:inline">
            {t('chat:misc.tokensLabel', { count: usedTokens })}
          </span>
        </>
      )}
    </button>
  );
}

/** Memoized: the composer re-renders on every keystroke and this row's numbers only move when a turn ends. */
export default memo(TokenUsageSummary);
