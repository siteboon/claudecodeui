import { Pin, X } from 'lucide-react';
import type { TFunction } from 'i18next';

import { cn } from '../../../../lib/utils';
import type { BookmarkedSession, BookmarkIdentity } from '../../../../stores/useBookmarkStore';
import SessionProviderLogo from '../../../llm-logo-provider/SessionProviderLogo';

type SidebarBookmarksProps = {
  bookmarks: BookmarkedSession[];
  selectedSessionId: string | null;
  onSelectBookmark: (bookmark: BookmarkedSession) => void;
  onRemoveBookmark: (bookmark: BookmarkIdentity) => void;
  t: TFunction;
};

export default function SidebarBookmarks({
  bookmarks,
  selectedSessionId,
  onSelectBookmark,
  onRemoveBookmark,
  t,
}: SidebarBookmarksProps) {
  if (bookmarks.length === 0) {
    return null;
  }

  return (
    <div className="mb-2 border-b border-border/60 px-2 pb-2">
      <div className="mb-1 flex items-center gap-1.5 px-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        <Pin className="h-3 w-3" />
        {t('bookmarks.title', 'Pinned')}
      </div>
      <div className="space-y-1">
        {bookmarks.map((bookmark) => {
          const selected = selectedSessionId === bookmark.sessionId;

          return (
            <div key={`${bookmark.projectId}:${bookmark.provider}:${bookmark.sessionId}`} className="group relative">
              <button
                type="button"
                className={cn(
                  'flex w-full items-center gap-2 rounded-md border p-2 text-left transition-colors',
                  selected ? 'border-primary/20 bg-primary/5' : 'border-border/30 bg-card hover:bg-accent/50',
                )}
                onClick={() => onSelectBookmark(bookmark)}
              >
                <SessionProviderLogo provider={bookmark.provider} className="h-3 w-3 flex-shrink-0" />
                <span className="min-w-0 flex-1 truncate text-xs text-foreground">{bookmark.sessionSummary}</span>
                <span className="hidden max-w-20 truncate text-[10px] text-muted-foreground md:inline">
                  {bookmark.projectDisplayName}
                </span>
              </button>
              <button
                type="button"
                className="absolute right-1 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded bg-background/90 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
                title={t('bookmarks.unpin', 'Unpin session')}
                onClick={(event) => {
                  event.stopPropagation();
                  onRemoveBookmark(bookmark);
                }}
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
