import { ChevronRight, MessageSquare } from 'lucide-react';
import type { MouseEvent } from 'react';
import type { TFunction } from 'i18next';

import { Button } from '../../../../shared/view/ui';
import { cn } from '../../../../lib/utils';
import type { ProjectSession } from '../../../../types/app';
import type { RecentConversationListItem } from '../../types/types';
import { formatCompactAge } from '../../utils/utils';
import SessionProviderLogo from '../../../llm-logo-provider/SessionProviderLogo';

type SidebarRecentConversationsProps = {
  conversations: RecentConversationListItem[];
  total: number;
  hasMore: boolean;
  isLoading: boolean;
  isLoadingMore: boolean;
  hasError: boolean;
  selectedSession: ProjectSession | null;
  currentTime: Date;
  onConversationSelect: (
    projectId: string | null,
    sessionId: string,
    provider: string,
  ) => void;
  onLoadMore: () => void;
  onRetry: () => void;
  t: TFunction;
};

function RecentConversationSkeleton() {
  return (
    <div className="space-y-1 px-1" aria-label="Loading recent conversations">
      {Array.from({ length: 8 }).map((_, index) => (
        <div key={index} className="flex items-center gap-2 rounded-lg px-2 py-2.5">
          <div className="h-7 w-7 animate-pulse rounded-md bg-muted" />
          <div className="min-w-0 flex-1 space-y-1.5">
            <div className="h-3 animate-pulse rounded bg-muted" style={{ width: `${72 - index * 3}%` }} />
            <div className="h-2.5 w-1/2 animate-pulse rounded bg-muted/70" />
          </div>
        </div>
      ))}
    </div>
  );
}

export default function SidebarRecentConversations({
  conversations,
  total,
  hasMore,
  isLoading,
  isLoadingMore,
  hasError,
  selectedSession,
  currentTime,
  onConversationSelect,
  onLoadMore,
  onRetry,
  t,
}: SidebarRecentConversationsProps) {
  if (isLoading && conversations.length === 0) {
    return <RecentConversationSkeleton />;
  }

  if (hasError && conversations.length === 0) {
    return (
      <div className="px-4 py-10 text-center">
        <MessageSquare className="mx-auto mb-3 h-6 w-6 text-muted-foreground" />
        <p className="text-sm font-medium text-foreground">
          {t('recent.loadFailed', 'Could not load recent conversations')}
        </p>
        <Button variant="ghost" size="sm" className="mt-2" onClick={onRetry}>
          {t('actions.retry', 'Try again')}
        </Button>
      </div>
    );
  }

  if (conversations.length === 0) {
    return (
      <div className="px-4 py-10 text-center">
        <MessageSquare className="mx-auto mb-3 h-6 w-6 text-muted-foreground" />
        <p className="text-sm font-medium text-foreground">
          {t('recent.emptyTitle', 'No conversations yet')}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          {t('recent.emptyDescription', 'Your most recently updated conversations will appear here.')}
        </p>
      </div>
    );
  }

  return (
    <div className="px-1" data-testid="recent-conversations-list">
      <div className="flex items-center justify-between px-2 pb-1.5 pt-0.5">
        <span className="text-[11px] font-medium text-muted-foreground">
          {t('recent.title', 'Recent conversations')}
        </span>
        <span className="text-[10px] tabular-nums text-muted-foreground/70">{total}</span>
      </div>

      <div className="space-y-0.5">
        {conversations.map((conversation) => {
          const isSelected = String(selectedSession?.id ?? '') === conversation.sessionId;
          const age = formatCompactAge(conversation.lastActivity, currentTime);

          const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
            if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
              return;
            }
            event.preventDefault();
            onConversationSelect(
              conversation.projectId,
              conversation.sessionId,
              conversation.provider,
            );
          };

          return (
            <a
              key={conversation.sessionId}
              href={`/session/${conversation.sessionId}`}
              onClick={handleClick}
              data-testid="recent-conversation-row"
              className={cn(
                'group flex min-w-0 items-center gap-2 rounded-lg px-2 py-2 text-left transition-colors',
                isSelected
                  ? 'bg-primary/10 text-foreground'
                  : 'text-foreground hover:bg-accent/60',
              )}
            >
              <span className={cn(
                'flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md',
                isSelected ? 'bg-primary/10' : 'bg-muted/60',
              )}>
                <SessionProviderLogo provider={conversation.provider} className="h-3.5 w-3.5" />
              </span>

              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-normal leading-4">
                  {conversation.sessionTitle}
                </span>
                <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[10px] leading-3 text-muted-foreground">
                  <span className="truncate">{conversation.projectDisplayName}</span>
                  {age && (
                    <>
                      <span className="flex-shrink-0 text-muted-foreground/40">·</span>
                      <time className="flex-shrink-0 tabular-nums" dateTime={conversation.lastActivity ?? undefined}>
                        {age}
                      </time>
                    </>
                  )}
                </span>
              </span>

              <ChevronRight className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground/40 transition-transform group-hover:translate-x-0.5 group-hover:text-muted-foreground" />
            </a>
          );
        })}
      </div>

      {hasMore && (
        <Button
          variant="ghost"
          size="sm"
          className="mt-1 h-8 w-full text-xs text-muted-foreground"
          onClick={onLoadMore}
          disabled={isLoadingMore}
        >
          {isLoadingMore
            ? t('recent.loadingMore', 'Loading more...')
            : t('recent.loadMore', 'Load older conversations')}
        </Button>
      )}
    </div>
  );
}
