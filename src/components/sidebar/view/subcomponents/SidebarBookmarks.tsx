import { Check, ChevronDown, ChevronRight, Edit2, Pin, Trash2, X } from 'lucide-react';
import { forwardRef, useImperativeHandle, useState } from 'react';
import type { TFunction } from 'i18next';
import { cn } from '../../../../lib/utils';
import type { BookmarkedSession } from '../../../../stores/useBookmarkStore';
import SessionProviderLogo from '../../../llm-logo-provider/SessionProviderLogo';

export type SidebarBookmarksRef = {
  collapse: () => void;
};

type SidebarBookmarksProps = {
  bookmarks: BookmarkedSession[];
  selectedSessionId: string | null;
  onSelectSession: (projectId: string, sessionId: string, provider: string) => void;
  onRemoveBookmark: (sessionId: string) => void;
  onDeleteSession: (projectId: string, sessionId: string, sessionTitle: string, provider: string) => void;
  editingSession: string | null;
  editingSessionName: string;
  onStartEditingSession: (sessionId: string, initialName: string) => void;
  onCancelEditingSession: () => void;
  onEditingSessionNameChange: (value: string) => void;
  onSaveEditingSession: (projectId: string, sessionId: string, summary: string, provider: string) => void;
  expandedProjects: Set<string>;
  onCollapseAllProjects: () => void;
  t: TFunction;
};

function formatCompactAge(dateString: string): string {
  if (!dateString) return '';
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return '';
  const diffInMinutes = Math.floor(Math.max(0, Date.now() - date.getTime()) / (1000 * 60));
  if (diffInMinutes < 1) return '<1m';
  if (diffInMinutes < 60) return `${diffInMinutes}m`;
  const diffInHours = Math.floor(diffInMinutes / 60);
  if (diffInHours < 24) return `${diffInHours}hr`;
  return `${Math.floor(diffInHours / 24)}d`;
}

function PinnedSessionRow({
  bookmark,
  isSelected,
  isEditing,
  editingName,
  onSelect,
  onUnpin,
  onDelete,
  onStartEditing,
  onCancelEditing,
  onEditingChange,
  onSaveEditing,
  t,
}: {
  bookmark: BookmarkedSession;
  isSelected: boolean;
  isEditing: boolean;
  editingName: string;
  onSelect: () => void;
  onUnpin: () => void;
  onDelete: () => void;
  onStartEditing: () => void;
  onCancelEditing: () => void;
  onEditingChange: (v: string) => void;
  onSaveEditing: () => void;
  t: TFunction;
}) {
  const compactAge = formatCompactAge(bookmark.bookmarkedAt);

  return (
    <div className="group relative">
      <div className="hidden md:block">
        <button
          className={cn(
            'w-full justify-start p-2 h-auto font-normal text-left hover:bg-accent/50 transition-colors duration-200',
            isSelected && 'bg-accent text-accent-foreground',
          )}
          onClick={onSelect}
        >
          <div className="flex w-full min-w-0 items-start gap-2">
            <SessionProviderLogo provider={bookmark.provider} className="mt-0.5 h-3 w-3 flex-shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <div className="truncate text-xs font-medium text-foreground">{bookmark.sessionSummary}</div>
                {compactAge && !isEditing && (
                  <span className="ml-auto flex-shrink-0 text-[11px] text-muted-foreground transition-opacity duration-200 group-hover:opacity-0">
                    {compactAge}
                  </span>
                )}
              </div>
            </div>
          </div>
        </button>

        <div
          className={cn(
            'absolute right-2 top-1/2 flex -translate-y-1/2 transform items-center gap-1 transition-all duration-200',
            isEditing ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
          )}
        >
          {isEditing ? (
            <>
              <input
                type="text" value={editingName}
                onChange={(e) => onEditingChange(e.target.value)}
                onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') onSaveEditing(); else if (e.key === 'Escape') onCancelEditing(); }}
                onClick={(e) => e.stopPropagation()}
                className="w-32 rounded border border-border bg-background px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
                autoFocus
              />
              <button className="flex h-6 w-6 items-center justify-center rounded bg-green-50 hover:bg-green-100 dark:bg-green-900/20 dark:hover:bg-green-900/40" onClick={(e) => { e.stopPropagation(); onSaveEditing(); }} title={t('tooltips.save')}>
                <Check className="h-3 w-3 text-green-600 dark:text-green-400" />
              </button>
              <button className="flex h-6 w-6 items-center justify-center rounded bg-gray-50 hover:bg-gray-100 dark:bg-gray-900/20 dark:hover:bg-gray-900/40" onClick={(e) => { e.stopPropagation(); onCancelEditing(); }} title={t('tooltips.cancel')}>
                <X className="h-3 w-3 text-gray-600 dark:text-gray-400" />
              </button>
            </>
          ) : (
            <>
              {/* Unpin — RED background */}
              <button className="flex h-6 w-6 items-center justify-center rounded bg-red-100 text-red-500 hover:bg-red-200 dark:bg-red-900/30 dark:hover:bg-red-900/50" onClick={(e) => { e.stopPropagation(); onUnpin(); }} title={t('bookmarks.unpin', 'Unpin session')}>
                <Pin className="h-3 w-3 rotate-45" />
              </button>
              <button className="flex h-6 w-6 items-center justify-center rounded bg-blue-100 text-blue-500 hover:bg-blue-200 dark:bg-blue-900/30 dark:hover:bg-blue-900/50" onClick={(e) => { e.stopPropagation(); onStartEditing(); }} title={t('tooltips.editSessionName')}>
                <Edit2 className="h-3 w-3" />
              </button>
              <button className="flex h-6 w-6 items-center justify-center rounded bg-red-100 text-red-500 hover:bg-red-200 dark:bg-red-900/30 dark:hover:bg-red-900/50" onClick={(e) => { e.stopPropagation(); onDelete(); }} title={t('tooltips.deleteSessionOptions')}>
                <Trash2 className="h-3 w-3 text-red-600 dark:text-red-400" />
              </button>
            </>
          )}
        </div>
      </div>

      {/* Mobile — matches SidebarSessionItem mobile layout */}
      <div className="md:hidden">
        <div
          className={cn('p-2 mx-3 my-0.5 rounded-md bg-card border active:scale-[0.98] transition-all duration-150 relative', isSelected ? 'bg-primary/5 border-primary/20' : 'border-border/30')}
          onClick={onSelect}
        >
          <div className="flex items-center gap-2">
            <div className={cn('w-5 h-5 rounded-md flex items-center justify-center flex-shrink-0', isSelected ? 'bg-primary/10' : 'bg-muted/50')}>
              <SessionProviderLogo provider={bookmark.provider} className="h-3 w-3" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <div className="truncate text-xs font-medium text-foreground">{bookmark.sessionSummary}</div>
                {compactAge && <span className="ml-auto flex-shrink-0 text-[11px] text-muted-foreground">{compactAge}</span>}
              </div>
            </div>

            {/* Actions inline on the right — always visible like normal sessions */}
            {isEditing ? (
              <>
                <input
                  type="text" value={editingName}
                  onChange={(e) => onEditingChange(e.target.value)}
                  onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') onSaveEditing(); else if (e.key === 'Escape') onCancelEditing(); }}
                  onClick={(e) => e.stopPropagation()}
                  className="w-32 rounded border border-border bg-background px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
                  autoFocus
                />
                <button type="button" className="flex h-5 w-5 items-center justify-center rounded-md bg-green-50 dark:bg-green-900/20" onClick={(e) => { e.stopPropagation(); onSaveEditing(); }} title={t('tooltips.save')}>
                  <Check className="h-2.5 w-2.5 text-green-600 dark:text-green-400" />
                </button>
                <button type="button" className="ml-1 flex h-5 w-5 items-center justify-center rounded-md bg-gray-50 dark:bg-gray-900/20" onClick={(e) => { e.stopPropagation(); onCancelEditing(); }} title={t('tooltips.cancel')}>
                  <X className="h-2.5 w-2.5 text-gray-600 dark:text-gray-400" />
                </button>
              </>
            ) : (
              <>
                <button type="button" className="ml-1 flex h-5 w-5 items-center justify-center rounded-md opacity-70 transition-transform active:scale-95 bg-red-50 dark:bg-red-900/20" onClick={(e) => { e.stopPropagation(); onUnpin(); }} title={t('bookmarks.unpin', 'Unpin session')}>
                  <Pin className="h-2.5 w-2.5 fill-red-500 text-red-500 rotate-45" />
                </button>
                <button type="button" className="ml-1 flex h-5 w-5 items-center justify-center rounded-md opacity-70 transition-transform active:scale-95 bg-blue-50 dark:bg-blue-900/20" onClick={(e) => { e.stopPropagation(); onStartEditing(); }} title={t('tooltips.editSessionName')}>
                  <Edit2 className="h-2.5 w-2.5 text-blue-600 dark:text-blue-400" />
                </button>
                <button type="button" className="ml-1 flex h-5 w-5 items-center justify-center rounded-md opacity-70 transition-transform active:scale-95 bg-red-50 dark:bg-red-900/20" onClick={(e) => { e.stopPropagation(); onDelete(); }} title={t('tooltips.deleteSessionOptions')}>
                  <Trash2 className="h-2.5 w-2.5 text-red-600 dark:text-red-400" />
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default forwardRef<SidebarBookmarksRef, SidebarBookmarksProps>(function SidebarBookmarks({
  bookmarks,
  selectedSessionId,
  onSelectSession,
  onRemoveBookmark,
  onDeleteSession,
  editingSession,
  editingSessionName,
  onStartEditingSession,
  onCancelEditingSession,
  onEditingSessionNameChange,
  onSaveEditingSession,
  expandedProjects,
  onCollapseAllProjects,
  t,
}, ref) {
  const [expanded, setExpanded] = useState(bookmarks.length > 0);

  useImperativeHandle(ref, () => ({
    collapse: () => setExpanded(false),
  }));

  if (!bookmarks.length) return null;

  const toggleExpanded = () => {
    const next = !expanded;
    setExpanded(next);
    if (next) {
      onCollapseAllProjects();
    }
  };

  return (
    <div className="md:space-y-1">
      <div className="md:group group">
        {/* Mobile header */}
        <div className="md:hidden">
          <div
            className="p-3 mx-3 my-1 rounded-lg bg-card border border-border/50 active:scale-[0.98] transition-all duration-150"
            onClick={toggleExpanded}
          >
            <div className="flex items-center justify-between">
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-blue-500/10 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800">
                  <Pin className="w-4 h-4 text-blue-600 dark:text-blue-400 fill-current" />
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="truncate text-sm font-medium text-foreground">{t('bookmarks.title', 'Pinned')}</h3>
                  <p className="text-xs text-muted-foreground">{bookmarks.length}</p>
                </div>
              </div>
              <div className="flex h-6 w-6 items-center justify-center rounded-md bg-muted/30">
                {expanded
                  ? <ChevronDown className="h-3 w-3 text-muted-foreground" />
                  : <ChevronRight className="h-3 w-3 text-muted-foreground" />
                }
              </div>
            </div>
          </div>
        </div>

        {/* Desktop header — mirrors SidebarProjectItem Button */}
        <button
          className="hidden md:flex w-full justify-between p-2 h-auto font-normal text-left hover:bg-accent/50 transition-colors duration-200"
          onClick={toggleExpanded}
        >
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <div className="w-6 h-6 flex items-center justify-center rounded">
              <Pin className="w-3.5 h-3.5 text-blue-500 dark:text-blue-400 fill-current" />
            </div>
            <div className="min-w-0 flex-1 text-left">
              <div className="truncate text-sm font-semibold text-foreground">
                {t('bookmarks.title', 'Pinned')}
                <span className="ml-1.5 text-xs font-normal text-muted-foreground">{bookmarks.length}</span>
              </div>
            </div>
          </div>
          <div className="flex flex-shrink-0 items-center gap-1">
            {expanded
              ? <ChevronDown className="h-4 w-4 text-muted-foreground transition-colors group-hover:text-foreground" />
              : <ChevronRight className="h-4 w-4 text-muted-foreground transition-colors group-hover:text-foreground" />
            }
          </div>
        </button>
      </div>

      {/* Session list — SAME container as SidebarProjectSessions */}
      {expanded && (
        <div className="ml-3 space-y-1 border-l border-border pl-3">
          {bookmarks.map((bm) => {
            const isSelected = selectedSessionId === bm.sessionId;
            const isEditing = editingSession === bm.sessionId;
            return (
              <PinnedSessionRow
                key={bm.sessionId}
                bookmark={bm}
                isSelected={isSelected}
                isEditing={isEditing}
                editingName={editingSessionName}
                onSelect={() => onSelectSession(bm.projectId, bm.sessionId, bm.provider)}
                onUnpin={() => onRemoveBookmark(bm.sessionId)}
                onDelete={() => onDeleteSession(bm.projectId, bm.sessionId, bm.sessionSummary, bm.provider)}
                onStartEditing={() => onStartEditingSession(bm.sessionId, bm.sessionSummary)}
                onCancelEditing={onCancelEditingSession}
                onEditingChange={onEditingSessionNameChange}
                onSaveEditing={() => onSaveEditingSession(bm.projectId, bm.sessionId, editingSessionName, bm.provider)}
                t={t}
              />
            );
          })}
        </div>
      )}
    </div>
  );
});
