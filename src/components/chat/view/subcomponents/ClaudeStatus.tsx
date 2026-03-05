import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '../../../../lib/utils';
import SessionProviderLogo from '../../../llm-logo-provider/SessionProviderLogo';

type ClaudeStatusProps = {
  status: {
    text?: string;
    tokens?: number;
    can_interrupt?: boolean;
  } | null;
  onAbort?: () => void;
  isLoading: boolean;
  provider?: string;
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
const ANIMATION_STEPS = 40;

const PROVIDER_LABEL_KEYS: Record<string, string> = {
  claude: 'messageTypes.claude',
  codex: 'messageTypes.codex',
  cursor: 'messageTypes.cursor',
  gemini: 'messageTypes.gemini',
};

function formatElapsedTime(totalSeconds: number, t: (key: string, options?: Record<string, unknown>) => string) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (minutes < 1) {
    return t('claudeStatus.elapsed.seconds', { count: seconds, defaultValue: '{{count}}s' });
  }

  return t('claudeStatus.elapsed.minutesSeconds', {
    minutes,
    seconds,
    defaultValue: '{{minutes}}m {{seconds}}s',
  });
}

export default function ClaudeStatus({
  status,
  onAbort,
  isLoading,
  provider = 'claude',
}: ClaudeStatusProps) {
  const { t } = useTranslation('chat');
  const [elapsedTime, setElapsedTime] = useState(0);
  const [animationPhase, setAnimationPhase] = useState(0);

  useEffect(() => {
    if (!isLoading) {
      setElapsedTime(0);
      return;
    }

    const startTime = Date.now();

    const timer = window.setInterval(() => {
      const elapsed = Math.floor((Date.now() - startTime) / 1000);
      setElapsedTime(elapsed);
    }, 1000);

    return () => window.clearInterval(timer);
  }, [isLoading]);

  useEffect(() => {
    if (!isLoading) {
      return;
    }

    const timer = window.setInterval(() => {
      setAnimationPhase((previous) => (previous + 1) % ANIMATION_STEPS);
    }, 500);

    return () => window.clearInterval(timer);
  }, [isLoading]);

  // Note: showThinking only controls the reasoning accordion in messages, not this processing indicator
  if (!isLoading && !status) {
    return null;
  }

  const actionWords = ACTION_KEYS.map((key, index) => t(key, { defaultValue: DEFAULT_ACTION_WORDS[index] }));
  const actionIndex = Math.floor(elapsedTime / 3) % actionWords.length;
  const statusText = status?.text || actionWords[actionIndex];
  const cleanStatusText = statusText.replace(/[.]+$/, '');
  const canInterrupt = isLoading && status?.can_interrupt !== false;
  const providerLabelKey = PROVIDER_LABEL_KEYS[provider];
  const providerLabel = providerLabelKey
    ? t(providerLabelKey)
    : t('claudeStatus.providers.assistant', { defaultValue: 'Assistant' });
  const animatedDots = '.'.repeat((animationPhase % 3) + 1);
  const elapsedLabel =
    elapsedTime > 0
      ? t('claudeStatus.elapsed.label', {
          time: formatElapsedTime(elapsedTime, t),
          defaultValue: '{{time}} elapsed',
        })
      : t('claudeStatus.elapsed.startingNow', { defaultValue: 'Starting now' });

  return (
    <div className="animate-in slide-in-from-bottom mb-3 w-full duration-300 sm:mb-6">
      <div className="relative mx-auto max-w-4xl overflow-hidden rounded-2xl border border-border/70 bg-card/90 shadow-md backdrop-blur-md">
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-primary/10 via-transparent to-sky-500/10 dark:from-primary/20 dark:to-sky-400/20" />

        <div className="relative px-3 py-3 sm:px-4 sm:py-3.5">
          <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-start gap-3" role="status" aria-live="polite">
              <div className="relative mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl border border-primary/25 bg-primary/10">
                <SessionProviderLogo provider={provider} className="h-5 w-5" />
                <span className="absolute -right-0.5 -top-0.5 flex h-2.5 w-2.5">
                  {isLoading && (
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400/70" />
                  )}
                  <span
                    className={cn(
                      'relative inline-flex h-2.5 w-2.5 rounded-full',
                      isLoading ? 'bg-emerald-400' : 'bg-amber-400',
                    )}
                  />
                </span>
              </div>

              <div className="min-w-0">
                <div className="mb-0.5 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">
                  <span>{providerLabel}</span>
                  <span
                    className={cn(
                      'rounded-full px-2 py-0.5 text-[9px] tracking-[0.14em]',
                      isLoading
                        ? 'bg-emerald-500/15 text-emerald-500 dark:text-emerald-400'
                        : 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
                    )}
                  >
                    {isLoading
                      ? t('claudeStatus.state.live', { defaultValue: 'Live' })
                      : t('claudeStatus.state.paused', { defaultValue: 'Paused' })}
                  </span>
                </div>

                <p className="truncate text-sm font-semibold text-foreground sm:text-[15px]">
                  {cleanStatusText}
                  {isLoading && (
                    <span aria-hidden="true" className="text-primary">
                      {animatedDots}
                    </span>
                  )}
                </p>

                <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground sm:text-xs">
                  <span
                    aria-hidden="true"
                    className="-ml-2 inline-flex items-center rounded-full border border-border/70 bg-background/60 px-2 py-0.5"
                  >
                    {elapsedLabel}
                  </span>
                </div>
              </div>
            </div>

            {canInterrupt && onAbort && (
              <div className="w-full sm:w-auto sm:text-right">
                <button
                  type="button"
                  onClick={onAbort}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-destructive px-3.5 py-2 text-sm font-semibold text-destructive-foreground shadow-sm ring-1 ring-destructive/40 transition-opacity hover:opacity-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive/70 active:opacity-90 sm:w-auto"
                >
                  <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                  <span>{t('claudeStatus.controls.stopGeneration', { defaultValue: 'Stop Generation' })}</span>
                  <span className="rounded-md bg-black/20 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-destructive-foreground/95">
                    Esc
                  </span>
                </button>

                <p className="mt-1 hidden text-[11px] text-muted-foreground sm:block">
                  {t('claudeStatus.controls.pressEscToStop', { defaultValue: 'Press Esc anytime to stop' })}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
