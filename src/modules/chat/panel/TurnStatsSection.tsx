import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import type { TurnStats } from '@/shared/types';
import { deriveTurnMetrics, formatDuration, formatTokenCount, formatTokPerSec } from '@/modules/chat/utils/sessionTurnStats';

type TurnStatsSectionProps = {
  mergedMessages: Parameters<typeof deriveTurnMetrics>[0];
  turnStats: TurnStats | null;
  tokenBudget: Record<string, unknown> | null;
};

/** A right-aligned gray metric row, matching the reference panel's layout. */
const StatRow = memo(({ label, value }: { label: string; value: string }) => (
  <div className="flex items-center justify-between py-0.5 text-xs">
    <span className="text-muted-foreground">{label}</span>
    <span className="font-mono text-foreground/70">{value}</span>
  </div>
));
StatRow.displayName = 'StatRow';

/**
 * The turn bill: speeds, durations, step count, token split, cache hit and
 * cost. Metrics the provider could not report render `—` rather than a zero,
 * so a mid-run or post-reload panel never claims a free or instant turn.
 */
export const TurnStatsSection = memo(({ mergedMessages, turnStats, tokenBudget }: TurnStatsSectionProps) => {
  const { t } = useTranslation('chat');
  const metrics = deriveTurnMetrics(mergedMessages, turnStats, tokenBudget);
  // Durations come straight from the provider's result frame when present;
  // without it the values are timestamp estimates, which the reference marks
  // with `~`.
  const exact = turnStats?.durationMs != null && turnStats?.apiDurationMs != null;

  return (
    <div>
      <StatRow label={t('sessionInfoPanel.stats.answerSpeed')} value={formatTokPerSec(metrics.answerSpeedTokPerSec, !exact)} />
      <StatRow label={t('sessionInfoPanel.stats.requestSpeed')} value={formatTokPerSec(metrics.requestSpeedTokPerSec, !exact)} />
      <StatRow label={t('sessionInfoPanel.stats.modelTime')} value={formatDuration(metrics.modelDurationMs)} />
      <StatRow label={t('sessionInfoPanel.stats.toolTime')} value={formatDuration(metrics.toolDurationMs)} />
      <StatRow label={t('sessionInfoPanel.stats.steps')} value={metrics.steps === null ? '—' : String(metrics.steps)} />
      <StatRow
        label={t('sessionInfoPanel.stats.tokens')}
        value={`${formatTokenCount(metrics.inputTokens)}↑ · ${formatTokenCount(metrics.outputTokens)}↓`}
      />
      <StatRow
        label={t('sessionInfoPanel.stats.cacheHit')}
        value={metrics.cacheHitPercent === null ? '—' : `${Math.round(metrics.cacheHitPercent)}%`}
      />
      <StatRow
        label={t('sessionInfoPanel.stats.cost')}
        value={metrics.costUsd === null ? '—' : `$${metrics.costUsd.toFixed(3)}`}
      />
    </div>
  );
});
TurnStatsSection.displayName = 'TurnStatsSection';
