import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import type { ProviderContextInfo } from '@/shared/types';

type ContextRingSectionProps = {
  /** From the provider's live CLI (its `/context` answer), when available. */
  contextInfo: ProviderContextInfo | null;
  /** Fallback: the streamed usage frame, same source as the composer counter. */
  tokenBudget: Record<string, unknown> | null;
  onShowDetails?: () => void;
};

/**
 * Context-window occupancy as ring + percentage + bar. The provider's own
 * answer wins (it classifies cached/deferred content the streamed frames
 * cannot); the streamed usage frame is the fallback so an idle session still
 * shows something. Click opens the existing token-detail modal.
 */
export const ContextRingSection = memo(({ contextInfo, tokenBudget, onShowDetails }: ContextRingSectionProps) => {
  const { t } = useTranslation('chat');
  const budget = (tokenBudget ?? {}) as Record<string, unknown>;
  const used = typeof budget.used === 'number' ? budget.used : null;
  const total = typeof budget.total === 'number' ? budget.total : null;

  const percent = contextInfo?.percentage ?? (used !== null && total ? (used / total) * 100 : null);
  const label = percent === null ? '—' : `${(Math.round(percent * 10) / 10).toFixed(1)}%`;
  const barWidth = percent === null ? 0 : Math.min(100, Math.max(0, percent));

  return (
    <button
      type="button"
      onClick={onShowDetails}
      className="flex w-full items-center gap-2.5 text-left disabled:cursor-default"
      disabled={!onShowDetails}
    >
      <ContextRing percent={percent} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">{t('sessionInfoPanel.context')}</span>
          <span className="font-mono text-xs text-foreground/80">{label}</span>
        </div>
        <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-green-500 transition-[width]"
            style={{ width: `${barWidth}%` }}
          />
        </div>
      </div>
    </button>
  );
});
ContextRingSection.displayName = 'ContextRingSection';

/** SVG ring whose filled arc tracks the percentage; a gauge glyph at rest. */
const ContextRing = memo(({ percent }: { percent: number | null }) => {
  const radius = 12;
  const circumference = 2 * Math.PI * radius;
  const filled = percent === null ? 0 : Math.min(100, Math.max(0, percent));

  return (
    <svg viewBox="0 0 32 32" className="h-8 w-8 flex-shrink-0 -rotate-90" aria-hidden="true">
      <circle cx="16" cy="16" r={radius} fill="none" strokeWidth="3" className="stroke-muted" />
      <circle
        cx="16"
        cy="16"
        r={radius}
        fill="none"
        strokeWidth="3"
        strokeLinecap="round"
        className="stroke-green-500 transition-[stroke-dashoffset]"
        strokeDasharray={`${(filled / 100) * circumference} ${circumference}`}
      />
    </svg>
  );
});
ContextRing.displayName = 'ContextRing';
