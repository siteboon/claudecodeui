import { Loader2, MessageSquare } from 'lucide-react';
import type { MouseEvent } from 'react';
import type { TFunction } from 'i18next';

import { Button, LLMProviderLogo, Tooltip } from '@/shared/ui';
import { cn } from '@/shared/utils';
import type { ProjectSession, RecentConversationListItem, SessionRowActions } from '@/shared/types';
import { formatCompactAge } from '@/modules/sidebar/utils/sidebarProjectFormatting';
import SessionOptions from '@/modules/sidebar/SessionOptions';

type SidebarRecentConversationsProps = {
  conversations: RecentConversationListItem[];
  total: number;
  hasMore: boolean;
  isLoading: boolean;
  isLoadingMore: boolean;
  hasError: boolean;
  selectedSession: ProjectSession | null;
  currentTime: Date;
  /**
   * The same row state and callbacks the Projects list hands its rows, so a
   * conversation can be renamed, copied, forked or archived from here too.
   */
  sessionActions: SessionRowActions;
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

/** Rendered by SidebarContent in the recents search mode to list recently active sessions across all projects. */
export default function SidebarRecentConversations({
  conversations,
  total,
  hasMore,
  isLoading,
  isLoadingMore,
  hasError,
  selectedSession,
  currentTime,
  sessionActions,
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
          {t('buttons.retry', { ns: 'common', defaultValue: 'Try again' })}
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
          const isProcessing = sessionActions.activeSessions.has(conversation.sessionId);
          const showAttentionIndicator =
            sessionActions.attentionSessionIds.has(conversation.sessionId) && !isSelected;
          // Resolved per row so a keystroke in one rename does not redraw the rest.
          const rename = sessionActions.activeRename;
          const sessionRename =
            rename?.target === 'session' && rename.id === conversation.sessionId ? rename : null;

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
            <div key={conversation.sessionId} className="group relative">
              {/*
                * Only the amber "needs attention" dot, and the spinner below. The
                * Projects row also has a green dot for a session touched recently,
                * which carries no information in a list ordered by recency.
                */}
              {showAttentionIndicator && (
                <div className="absolute left-0 top-1/2 -translate-x-1 -translate-y-1/2 transform">
                  <Tooltip
                    content={t('tooltips.attentionRequiredIndicator', { defaultValue: 'Session needs attention' })}
                    position="right"
                  >
                    <div
                      role="status"
                      aria-label={t('tooltips.attentionRequiredIndicator', { defaultValue: 'Session needs attention' })}
                      className="h-2 w-2 animate-pulse rounded-full bg-amber-500"
                    />
                  </Tooltip>
                </div>
              )}

              <a
                href={`/session/${conversation.sessionId}`}
                onClick={handleClick}
                data-testid="recent-conversation-row"
                className={cn(
                  'flex min-w-0 items-center gap-2 rounded-lg px-2 py-2 pr-11 text-left transition-colors',
                  isSelected
                    ? 'bg-primary/10 text-foreground'
                    : 'text-foreground hover:bg-accent/60',
                )}
              >
                <span className={cn(
                  'flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md',
                  isSelected ? 'bg-primary/10' : 'bg-muted/60',
                )}>
                  <LLMProviderLogo provider={conversation.provider} className="h-3.5 w-3.5" />
                </span>

                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-normal leading-4">
                    {conversation.sessionTitle}
                  </span>
                  <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[10px] leading-3 text-muted-foreground">
                    <span className="truncate">{conversation.projectDisplayName}</span>
                    {isProcessing ? (
                      <>
                        <span className="flex-shrink-0 text-muted-foreground/40">·</span>
                        <Tooltip content={t('tooltips.processingSessionIndicator', 'Processing session')} position="top">
                          <Loader2 className="h-3 w-3 flex-shrink-0 animate-spin" />
                        </Tooltip>
                      </>
                    ) : age && (
                      <>
                        <span className="flex-shrink-0 text-muted-foreground/40">·</span>
                        <time className="flex-shrink-0 tabular-nums" dateTime={conversation.lastActivity ?? undefined}>
                          {age}
                        </time>
                      </>
                    )}
                  </span>
                </span>
              </a>

              <SessionOptions
                className="absolute right-2 top-1/2 -translate-y-1/2 transform"
                sessionId={conversation.sessionId}
                sessionName={conversation.sessionTitle}
                provider={conversation.provider}
                projectId={conversation.projectId}
                isProcessing={isProcessing}
                isEditing={sessionRename !== null}
                renameDraft={sessionRename?.draft ?? ''}
                onRenameDraftChange={sessionActions.onRenameDraftChange}
                onStartEditingSession={sessionActions.onStartEditingSession}
                onCancelEditingSession={sessionActions.onCancelEditingSession}
                onSaveEditingSession={sessionActions.onSaveEditingSession}
                onDeleteSession={sessionActions.onDeleteSession}
                // The fork path reads only the id, provider and owning project,
                // which is all a recents row knows about the session.
                onFork={sessionActions.onForkSession
                  ? () => sessionActions.onForkSession?.({
                    id: conversation.sessionId,
                    summary: conversation.sessionTitle,
                    __provider: conversation.provider,
                    __projectId: conversation.projectId ?? undefined,
                  })
                  : undefined}
                t={t}
              />
            </div>
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
