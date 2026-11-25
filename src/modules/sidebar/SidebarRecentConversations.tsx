import { Loader2, MessageSquare } from 'lucide-react';
import { useEffect, useRef } from 'react';
import type { MouseEvent, ReactNode } from 'react';
import type { TFunction } from 'i18next';

import { Button } from '@/shared/ui';
import { cn } from '@/shared/utils';
import type { ProjectSession, RecentConversationListItem, SessionListKind, SessionRowActions } from '@/shared/types';
import { formatCompactAge } from '@/modules/sidebar/utils/sidebarProjectFormatting';
import SessionOptions from '@/modules/sidebar/SessionOptions';
import SessionStatusIcon from '@/modules/sidebar/SessionStatusIcon';
import SidebarSectionHeader from '@/modules/sidebar/SidebarSectionHeader';
import { useSessionPins } from '@/modules/sidebar/hooks/useSessionPins';

type SidebarRecentConversationsProps = {
  /** Pinned and Active are short cross-project lists; only Recent pages, and drops sessions the Pinned list already shows. */
  listKind?: SessionListKind;
  /** The section header; Recent falls back to "Recent". */
  title?: string;
  /** A control on the right of the section header, such as the view toggle. */
  headerAction?: ReactNode;
  /** Leave out sessions the Pinned section already shows, so the lists above the project tree never repeat a row. */
  excludePinned?: boolean;
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
  listKind = 'recent',
  title,
  headerAction,
  excludePinned = false,
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
  // The row after the last conversation: once it scrolls into view, the next
  // page loads, so older conversations arrive without clicking the button.
  const loadMoreSentinelRef = useRef<HTMLDivElement>(null);
  // Latest onLoadMore, so a new callback identity does not rebuild the observer.
  const onLoadMoreRef = useRef(onLoadMore);
  // The list length when a page was last requested by scrolling. A page that
  // added nothing (e.g. all duplicates) leaves it unchanged, which stops the
  // automatic loading instead of requesting the same page in a loop.
  const autoLoadedAtLengthRef = useRef<number | null>(null);
  // A full reload replaces the list, so a page requested during it would be
  // dropped; the observer comes back once the reload finishes.
  const canAutoLoadMore = hasMore && !isLoading && !isLoadingMore && !hasError;
  const conversationCount = conversations.length;

  useEffect(() => {
    onLoadMoreRef.current = onLoadMore;
  }, [onLoadMore]);

  // A full reload starts a new list, which may again have the stopped length.
  useEffect(() => {
    if (isLoading) {
      autoLoadedAtLengthRef.current = null;
    }
  }, [isLoading]);

  useEffect(() => {
    const sentinel = loadMoreSentinelRef.current;
    if (
      !canAutoLoadMore
      || !sentinel
      || autoLoadedAtLengthRef.current === conversationCount
      || typeof IntersectionObserver === 'undefined'
    ) {
      return undefined;
    }

    // Re-created after each page (the loading flag and length change), so a
    // sentinel that is still visible after a short page loads the next one.
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) {
        return;
      }
      observer.disconnect();
      autoLoadedAtLengthRef.current = conversationCount;
      onLoadMoreRef.current();
    });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [canAutoLoadMore, conversationCount]);

  const pins = useSessionPins();
  const isRecentList = listKind === 'recent';
  const isPinnedList = listKind === 'pinned';
  const visibleConversations = isPinnedList || !pins || !excludePinned
    ? conversations
    : conversations.filter((conversation) => !pins.pinnedIds.has(conversation.sessionId));
  // Status never moves a row in Active or Pinned, so each header says how many need a reply.
  const needsReplyCount = !isRecentList
    ? visibleConversations.filter((conversation) => (
      sessionActions.attentionSessionIds.has(conversation.sessionId) && String(selectedSession?.id ?? '') !== conversation.sessionId
    )).length
    : 0;
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

  if (!isPinnedList && excludePinned && pins && pins.sessions.length > 0 && visibleConversations.length === 0 && !hasMore) {
    return null;
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
    <div data-testid={`${listKind}-conversations-list`}>
      <SidebarSectionHeader
        label={title ?? t('recent.title', 'Recent')}
        count={isRecentList && excludePinned ? Math.max(0, total - (pins?.sessions.length ?? 0)) : visibleConversations.length}
        note={needsReplyCount > 0 ? t('sections.needsReply', { count: needsReplyCount, defaultValue: '{{count}} needs reply' }) : undefined}
        action={headerAction}
      />

      <div className="space-y-0.5">
        {visibleConversations.map((conversation) => {
          const isSelected = String(selectedSession?.id ?? '') === conversation.sessionId;
          const age = formatCompactAge(conversation.lastActivity, currentTime);
          const hasBackgroundWork = sessionActions.backgroundSessionIds.has(conversation.sessionId);
          const isProcessing = sessionActions.activeSessions.has(conversation.sessionId) && !hasBackgroundWork;
          const showAttentionIndicator =
            sessionActions.attentionSessionIds.has(conversation.sessionId) && !isSelected;
          // Resolved per row so a keystroke in one rename does not redraw the rest.
          const rename = sessionActions.activeRename;
          const sessionRename =
            rename?.target === 'session' && rename.id === conversation.sessionId && rename.origin === listKind ? rename : null;

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
              <a
                href={`/session/${conversation.sessionId}`}
                onClick={handleClick}
                data-testid="recent-conversation-row"
                className={cn(
                  'flex min-w-0 items-start gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors',
                  isSelected ? 'bg-accent' : 'hover:bg-accent/50',
                )}
              >
                <SessionStatusIcon
                  provider={conversation.provider}
                  needsAttention={showAttentionIndicator}
                  isProcessing={isProcessing}
                  hasBackgroundWork={hasBackgroundWork}
                  t={t}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate pr-7 text-row text-foreground">
                    {conversation.sessionTitle}
                  </span>
                  <span className="flex min-w-0 items-center gap-2 text-xs leading-4 text-muted-foreground">
                    <span className="min-w-0 flex-1 truncate">{conversation.projectDisplayName}</span>
                    {age && !isProcessing && !hasBackgroundWork && (
                      <time className="flex-shrink-0 tabular-nums" dateTime={conversation.lastActivity ?? undefined}>
                        {age}
                      </time>
                    )}
                  </span>
                </span>
              </a>

              <SessionOptions
                className="absolute right-1.5 top-1.5"
                sessionId={conversation.sessionId}
                sessionName={conversation.sessionTitle}
                provider={conversation.provider}
                projectId={conversation.projectId}
                isProcessing={isProcessing}
                isEditing={sessionRename !== null}
                renameDraft={sessionRename?.draft ?? ''}
                onRenameDraftChange={sessionActions.onRenameDraftChange}
                onStartEditingSession={(projectId, sessionId, initialName) => (
                  sessionActions.onStartEditingSession(projectId, sessionId, initialName, listKind)
                )}
                onCancelEditingSession={sessionActions.onCancelEditingSession}
                onSaveEditingSession={sessionActions.onSaveEditingSession}
                onArchiveSession={sessionActions.onArchiveSession}
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
        // Kept as a button: a fallback where scrolling cannot trigger the load
        // (no IntersectionObserver, a failed page) and for keyboard users.
        <div ref={loadMoreSentinelRef} data-testid="recent-conversations-load-more">
          <Button
            variant="ghost"
            size="sm"
            className="mt-1 h-8 w-full text-xs text-muted-foreground"
            onClick={onLoadMore}
            disabled={isLoadingMore}
          >
            {isLoadingMore ? (
              <>
                <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
                {t('recent.loadingMore', 'Loading more...')}
              </>
            ) : t('recent.loadMore', 'Load older conversations')}
          </Button>
        </div>
      )}
    </div>
  );
}
