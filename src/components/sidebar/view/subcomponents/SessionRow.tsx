import type { MouseEvent, ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import type { TFunction } from 'i18next';

import { Tooltip, buttonVariants } from '../../../../shared/view/ui';
import { cn } from '../../../../lib/utils';
import type { LLMProvider } from '../../../../types/app';
import LLMProviderLogo from '../../../llm-provider-logo/LLMProviderLogo';

type SessionRowProps = {
  href: string;
  title: string;
  provider: LLMProvider;
  /** Compact last-activity, shown unless the session is processing. */
  age: string;
  isSelected: boolean;
  isProcessing: boolean;
  needsAttention: boolean;
  /** Touched in the last ten minutes, which tints the border and the dot. */
  isRecentlyActive: boolean;
  /** True while this row's own rename is open, which fades the trailing age. */
  isEditing: boolean;
  /** Second line: a message count under Projects, a project name under Conversations. */
  secondLine?: ReactNode;
  /** The row's trailing controls, positioned over its right edge. */
  actions: ReactNode;
  onSelect: () => void;
  dataTestId?: string;
  t: TFunction;
};

/**
 * A session, as both sidebar lists draw one: a dot at the left edge for a
 * session that is running or waiting, the provider's mark, its name, and either
 * a spinner or how long ago it was touched.
 */
export default function SessionRow({
  href,
  title,
  provider,
  age,
  isSelected,
  isProcessing,
  needsAttention,
  isRecentlyActive,
  isEditing,
  secondLine,
  actions,
  onSelect,
  dataTestId,
  t,
}: SessionRowProps) {
  const showAttentionIndicator = needsAttention && !isSelected;
  const showRecentIndicator = !showAttentionIndicator && !isProcessing && isRecentlyActive;
  const indicatorLabel = showAttentionIndicator
    ? t('tooltips.attentionRequiredIndicator', { defaultValue: 'Session needs attention' })
    : t('tooltips.activeSessionIndicator');

  // Left-click keeps in-app navigation; Ctrl/Cmd/middle-click and the native
  // right-click menu use the href to open a new tab or window.
  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    onSelect();
  };

  return (
    <div className="group relative">
      {(showAttentionIndicator || showRecentIndicator) && (
        <div className="absolute left-0 top-1/2 -translate-x-1 -translate-y-1/2 transform">
          <Tooltip content={indicatorLabel} position="right">
            <div
              role="status"
              aria-label={indicatorLabel}
              className={cn(
                'h-2 w-2 animate-pulse rounded-full',
                showAttentionIndicator ? 'bg-amber-500' : 'bg-green-500',
              )}
            />
          </Tooltip>
        </div>
      )}

      <a
        href={href}
        data-testid={dataTestId}
        className={cn(
          buttonVariants({ variant: 'ghost' }),
          'h-auto w-full justify-start rounded-md border bg-card p-2 pr-11 text-left font-normal transition-all duration-150',
          isSelected ? 'border-primary/20 bg-primary/5' : 'border-border/30',
          !isSelected && isProcessing
            ? 'border-border/60 bg-muted/20 hover:bg-muted/25'
            : !isSelected && isRecentlyActive
              ? 'border-green-500/30 bg-green-50/5 hover:bg-green-50/10 dark:bg-green-900/5 dark:hover:bg-green-900/10'
              : 'hover:bg-accent/50',
        )}
        onClick={handleClick}
      >
        <div className="flex w-full min-w-0 items-center gap-2">
          <div
            className={cn(
              'flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-md',
              isSelected ? 'bg-primary/10' : 'bg-muted/50',
            )}
          >
            <LLMProviderLogo provider={provider} className="h-3 w-3" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <div className="min-w-0 flex-1 truncate text-sm font-normal text-foreground" title={title}>
                {title}
              </div>
              {isProcessing ? (
                <span
                  className={cn(
                    'ml-auto flex-shrink-0 transition-opacity duration-200',
                    isEditing ? 'opacity-0' : 'group-hover:opacity-0',
                  )}
                >
                  <Tooltip content={t('tooltips.processingSessionIndicator', 'Processing session')} position="top">
                    <span className="flex h-5 w-5 items-center justify-center rounded-md text-muted-foreground">
                      <Loader2 className="h-3 w-3 animate-spin" />
                    </span>
                  </Tooltip>
                </span>
              ) : age && (
                <span
                  className={cn(
                    'ml-auto flex-shrink-0 text-[11px] text-muted-foreground transition-opacity duration-200',
                    isEditing ? 'opacity-0' : 'group-hover:opacity-0',
                  )}
                >
                  {age}
                </span>
              )}
            </div>
            <div className="mt-0.5 flex min-w-0 items-center">{secondLine}</div>
          </div>
        </div>
      </a>

      {actions}
    </div>
  );
}
