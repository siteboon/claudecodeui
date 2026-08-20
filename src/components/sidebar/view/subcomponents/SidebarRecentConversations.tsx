import { MessageSquare } from 'lucide-react';
import type { TFunction } from 'i18next';

import { Button } from '../../../../shared/view/ui';
import type { ProjectSession } from '../../../../types/app';
import type { RecentConversationListItem, SessionRowActions } from '../../types/types';
import { formatCompactAge, isSessionRecentlyActive } from '../../utils/utils';

import SessionOptions from './SessionOptions';
import SessionRow from './SessionRow';

type SidebarRecentConversationsProps = {
  conversations: RecentConversationListItem[];
  total: number;
  hasMore: boolean;
  isLoading: boolean;
  isLoadingMore: boolean;
  hasError: boolean;
  selectedSession: ProjectSession | null;
  currentTime: Date;
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
          const isProcessing = sessionActions.activeSessions.has(conversation.sessionId);
          const isEditing = sessionActions.editingSession === conversation.sessionId;

          return (
            <SessionRow
              key={conversation.sessionId}
              href={`/session/${conversation.sessionId}`}
              dataTestId="recent-conversation-row"
              title={conversation.sessionTitle}
              provider={conversation.provider}
              age={formatCompactAge(conversation.lastActivity, currentTime)}
              isSelected={String(selectedSession?.id ?? '') === conversation.sessionId}
              isProcessing={isProcessing}
              needsAttention={sessionActions.attentionSessionIds.has(conversation.sessionId)}
              isRecentlyActive={isSessionRecentlyActive(conversation.lastActivity, currentTime)}
              isEditing={isEditing}
              // The one thing a conversation row says that a session row under a
              // project does not have to: which project it belongs to.
              secondLine={(
                <span className="truncate text-[10px] leading-3 text-muted-foreground">
                  {conversation.projectDisplayName}
                </span>
              )}
              onSelect={() => onConversationSelect(
                conversation.projectId,
                conversation.sessionId,
                conversation.provider,
              )}
              actions={(
                <SessionOptions
                  sessionId={conversation.sessionId}
                  provider={conversation.provider}
                  sessionTitle={conversation.sessionTitle}
                  canDelete={!isProcessing}
                  isEditing={isEditing}
                  editingName={sessionActions.editingSessionName}
                  onEditingNameChange={sessionActions.onEditingSessionNameChange}
                  onStartRename={() => sessionActions.onStartEditingSession(
                    conversation.sessionId,
                    conversation.sessionTitle,
                  )}
                  onCancelRename={sessionActions.onCancelEditingSession}
                  onSaveRename={() => sessionActions.onSaveEditingSession(
                    conversation.projectId,
                    conversation.sessionId,
                    sessionActions.editingSessionName,
                    conversation.provider,
                  )}
                  onRequestDelete={() => sessionActions.onDeleteSession(
                    conversation.projectId,
                    conversation.sessionId,
                    conversation.sessionTitle,
                    conversation.provider,
                  )}
                  className="absolute right-2 top-1/2 -translate-y-1/2 transform opacity-100 transition-all duration-200"
                  t={t}
                />
              )}
              t={t}
            />
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
