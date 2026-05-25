import { useEffect, useRef, useState } from 'react';
import { Check, Edit2, GitBranch, Star, Trash2, X } from 'lucide-react';
import type { TFunction } from 'i18next';

import { Badge, Button } from '../../../../shared/view/ui';
import { cn } from '../../../../lib/utils';
import type { Project, ProjectSession, LLMProvider, Worktree } from '../../../../types/app';
import type { SessionWithProvider } from '../../types/types';
import { createSessionViewModel } from '../../utils/utils';
import SessionProviderLogo from '../../../llm-logo-provider/SessionProviderLogo';
import { useStarredSessions } from '../../../../hooks/useStarredSessions';

type SidebarSessionItemProps = {
  project: Project;
  session: SessionWithProvider;
  selectedSession: ProjectSession | null;
  currentTime: Date;
  editingSession: string | null;
  editingSessionName: string;
  onEditingSessionNameChange: (value: string) => void;
  onStartEditingSession: (sessionId: string, initialName: string) => void;
  onCancelEditingSession: () => void;
  onSaveEditingSession: (projectName: string, sessionId: string, summary: string, provider: LLMProvider) => void;
  onProjectSelect: (project: Project) => void;
  onSessionSelect: (session: SessionWithProvider, projectName: string) => void;
  onDeleteSession: (
    projectName: string,
    sessionId: string,
    sessionTitle: string,
    provider: LLMProvider,
  ) => void;
  // The worktree list to offer on right-click. When provided with >1 entries,
  // users can pick a worktree to open this session against. Null/empty hides
  // the menu (non-git projects, single-worktree repos).
  worktreesForOpenIn?: Worktree[];
  onOpenSessionInWorktree?: (session: SessionWithProvider, project: Project, worktree: Worktree) => void;
  t: TFunction;
};

const formatCompactSessionAge = (dateString: string, currentTime: Date): string => {
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) {
    return '';
  }

  const diffInMinutes = Math.floor(Math.max(0, currentTime.getTime() - date.getTime()) / (1000 * 60));
  if (diffInMinutes < 1) {
    return '<1m';
  }

  if (diffInMinutes < 60) {
    return `${diffInMinutes}m`;
  }

  const diffInHours = Math.floor(diffInMinutes / 60);
  if (diffInHours < 24) {
    return `${diffInHours}hr`;
  }

  const diffInDays = Math.floor(diffInHours / 24);
  return `${diffInDays}d`;
};

export default function SidebarSessionItem({
  project,
  session,
  selectedSession,
  currentTime,
  editingSession,
  editingSessionName,
  onEditingSessionNameChange,
  onStartEditingSession,
  onCancelEditingSession,
  onSaveEditingSession,
  onProjectSelect,
  onSessionSelect,
  onDeleteSession,
  worktreesForOpenIn,
  onOpenSessionInWorktree,
  t,
}: SidebarSessionItemProps) {
  const sessionView = createSessionViewModel(session, currentTime, t);
  const isSelected = selectedSession?.id === session.id;
  const compactSessionAge = formatCompactSessionAge(sessionView.sessionTime, currentTime);

  const { isStarred: isSessionStar, toggle: toggleSessionStar } = useStarredSessions();
  const sessionStarred = isSessionStar(session.id);

  const [menuPosition, setMenuPosition] = useState<{ x: number; y: number } | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const canOpenInWorktree = Boolean(
    onOpenSessionInWorktree && worktreesForOpenIn && worktreesForOpenIn.length > 1,
  );

  useEffect(() => {
    if (!menuPosition) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuPosition(null);
      }
    };
    const handleEsc = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuPosition(null);
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEsc);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEsc);
    };
  }, [menuPosition]);

  const selectMobileSession = () => {
    onProjectSelect(project);
    onSessionSelect(session, project.projectId);
  };

  const saveEditedSession = () => {
    onSaveEditingSession(project.projectId, session.id, editingSessionName, session.__provider);
  };

  const requestDeleteSession = () => {
    onDeleteSession(project.projectId, session.id, sessionView.sessionName, session.__provider);
  };

  const handleContextMenu = (event: React.MouseEvent) => {
    if (!canOpenInWorktree) return;
    event.preventDefault();
    setMenuPosition({ x: event.clientX, y: event.clientY });
  };

  const handleWorktreePick = (worktree: Worktree) => {
    setMenuPosition(null);
    onOpenSessionInWorktree?.(session, project, worktree);
  };

  return (
    <div className="group relative" onContextMenu={handleContextMenu}>
      {sessionView.isActive && (
        <div className="absolute left-0 top-1/2 -translate-x-1 -translate-y-1/2 transform">
          <div className="h-2 w-2 animate-pulse rounded-full bg-green-500" />
        </div>
      )}

      <div className="md:hidden">
        <div
          className={cn(
            'p-2 mx-3 my-0.5 rounded-md bg-card border active:scale-[0.98] transition-all duration-150 relative',
            isSelected ? 'bg-primary/5 border-primary/20' : '',
            !isSelected && sessionView.isActive
              ? 'border-green-500/30 bg-green-50/5 dark:bg-green-900/5'
              : 'border-border/30',
          )}
          onClick={selectMobileSession}
        >
          <div className="flex items-center gap-2">
            <div
              className={cn(
                'w-5 h-5 rounded-md flex items-center justify-center flex-shrink-0',
                isSelected ? 'bg-primary/10' : 'bg-muted/50',
              )}
            >
              <SessionProviderLogo provider={session.__provider} className="h-3 w-3" />
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span
                  role="button"
                  tabIndex={0}
                  className={cn(
                    'flex h-4 w-4 flex-shrink-0 cursor-pointer items-center justify-center rounded transition-colors',
                    sessionStarred
                      ? 'text-yellow-500 hover:text-yellow-600 dark:text-yellow-400'
                      : 'text-muted-foreground/30 hover:text-yellow-500 dark:hover:text-yellow-400',
                  )}
                  onClick={(event) => {
                    event.stopPropagation();
                    toggleSessionStar(session.id);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      event.stopPropagation();
                      toggleSessionStar(session.id);
                    }
                  }}
                  aria-pressed={sessionStarred}
                  aria-label={sessionStarred ? 'Unstar session' : 'Star session'}
                  title={sessionStarred ? 'Unstar session' : 'Star session'}
                >
                  <Star
                    className={cn('h-3 w-3', sessionStarred && 'fill-current')}
                  />
                </span>
                <div className="truncate text-xs font-medium text-foreground">{sessionView.sessionName}</div>
                {compactSessionAge && (
                  <span className="ml-auto flex-shrink-0 text-[11px] text-muted-foreground">{compactSessionAge}</span>
                )}
              </div>
              <div className="mt-0.5 flex items-center">
                {sessionView.messageCount > 0 && (
                  <Badge variant="secondary" className="px-1 py-0 text-xs">
                    {sessionView.messageCount}
                  </Badge>
                )}
              </div>
            </div>

            <button
              className={cn(
                'ml-1 flex h-5 w-5 items-center justify-center rounded-md transition-transform active:scale-95',
                sessionStarred
                  ? 'text-yellow-500 dark:text-yellow-400'
                  : 'text-muted-foreground/50',
              )}
              onClick={(event) => {
                event.stopPropagation();
                toggleSessionStar(session.id);
              }}
              aria-pressed={sessionStarred}
              aria-label={sessionStarred ? 'Unstar session' : 'Star session'}
            >
              <Star className={cn('h-3 w-3', sessionStarred && 'fill-current')} />
            </button>
            {!sessionView.isCursorSession && (
              <button
                className="ml-1 flex h-5 w-5 items-center justify-center rounded-md bg-red-50 opacity-70 transition-transform active:scale-95 dark:bg-red-900/20"
                onClick={(event) => {
                  event.stopPropagation();
                  requestDeleteSession();
                }}
              >
                <Trash2 className="h-2.5 w-2.5 text-red-600 dark:text-red-400" />
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="hidden md:block">
        <Button
          variant="ghost"
          className={cn(
            'w-full justify-start p-2 h-auto font-normal text-left hover:bg-accent/50 transition-colors duration-200',
            isSelected && 'bg-accent text-accent-foreground',
          )}
          onClick={() => onSessionSelect(session, project.projectId)}
        >
          <div className="flex w-full min-w-0 items-start gap-2">
            <SessionProviderLogo provider={session.__provider} className="mt-0.5 h-3 w-3 flex-shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span
                  role="button"
                  tabIndex={0}
                  className={cn(
                    'flex h-4 w-4 flex-shrink-0 cursor-pointer items-center justify-center rounded transition-colors',
                    sessionStarred
                      ? 'text-yellow-500 hover:text-yellow-600 dark:text-yellow-400'
                      : 'text-muted-foreground/30 hover:text-yellow-500 dark:hover:text-yellow-400',
                  )}
                  onClick={(event) => {
                    event.stopPropagation();
                    toggleSessionStar(session.id);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      event.stopPropagation();
                      toggleSessionStar(session.id);
                    }
                  }}
                  aria-pressed={sessionStarred}
                  aria-label={sessionStarred ? 'Unstar session' : 'Star session'}
                  title={sessionStarred ? 'Unstar session' : 'Star session'}
                >
                  <Star
                    className={cn('h-3 w-3', sessionStarred && 'fill-current')}
                  />
                </span>
                <div className="truncate text-xs font-medium text-foreground">{sessionView.sessionName}</div>
                {compactSessionAge && (
                  <span className="ml-auto flex-shrink-0 text-[11px] text-muted-foreground transition-opacity duration-200 group-hover:opacity-0">
                    {compactSessionAge}
                  </span>
                )}
              </div>
              <div className="mt-0.5 flex items-center">
                {sessionView.messageCount > 0 && <Badge variant="secondary" className="px-1 py-0 text-xs">{sessionView.messageCount}</Badge>}
              </div>
            </div>
          </div>
        </Button>

        <div className="absolute right-2 top-1/2 flex -translate-y-1/2 transform items-center gap-1 opacity-0 transition-all duration-200 group-hover:opacity-100">
            {editingSession === session.id ? (
              <>
                <input
                  type="text"
                  value={editingSessionName}
                  onChange={(event) => onEditingSessionNameChange(event.target.value)}
                  onKeyDown={(event) => {
                    event.stopPropagation();
                    if (event.key === 'Enter') {
                      saveEditedSession();
                    } else if (event.key === 'Escape') {
                      onCancelEditingSession();
                    }
                  }}
                  onClick={(event) => event.stopPropagation()}
                  className="w-32 rounded border border-border bg-background px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
                  autoFocus
                />
                <button
                  className="flex h-6 w-6 items-center justify-center rounded bg-green-50 hover:bg-green-100 dark:bg-green-900/20 dark:hover:bg-green-900/40"
                  onClick={(event) => {
                    event.stopPropagation();
                    saveEditedSession();
                  }}
                  title={t('tooltips.save')}
                >
                  <Check className="h-3 w-3 text-green-600 dark:text-green-400" />
                </button>
                <button
                  className="flex h-6 w-6 items-center justify-center rounded bg-gray-50 hover:bg-gray-100 dark:bg-gray-900/20 dark:hover:bg-gray-900/40"
                  onClick={(event) => {
                    event.stopPropagation();
                    onCancelEditingSession();
                  }}
                  title={t('tooltips.cancel')}
                >
                  <X className="h-3 w-3 text-gray-600 dark:text-gray-400" />
                </button>
              </>
            ) : (
              <>
                {canOpenInWorktree && (
                  <button
                    className="flex h-6 w-6 items-center justify-center rounded bg-blue-50 hover:bg-blue-100 dark:bg-blue-900/20 dark:hover:bg-blue-900/40"
                    onClick={(event) => {
                      event.stopPropagation();
                      const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
                      setMenuPosition({ x: rect.left, y: rect.bottom + 4 });
                    }}
                    title="Open in worktree"
                  >
                    <GitBranch className="h-3 w-3 text-blue-600 dark:text-blue-400" />
                  </button>
                )}
                <button
                  className="flex h-6 w-6 items-center justify-center rounded bg-gray-50 hover:bg-gray-100 dark:bg-gray-900/20 dark:hover:bg-gray-900/40"
                  onClick={(event) => {
                    event.stopPropagation();
                    onStartEditingSession(session.id, sessionView.sessionName);
                  }}
                  title={t('tooltips.editSessionName')}
                >
                  <Edit2 className="h-3 w-3 text-gray-600 dark:text-gray-400" />
                </button>
                {!sessionView.isCursorSession && (
                  <button
                    className="flex h-6 w-6 items-center justify-center rounded bg-red-50 hover:bg-red-100 dark:bg-red-900/20 dark:hover:bg-red-900/40"
                    onClick={(event) => {
                      event.stopPropagation();
                      requestDeleteSession();
                    }}
                    title={t('tooltips.deleteSessionOptions', 'Archive or permanently delete this session')}
                  >
                    <Trash2 className="h-3 w-3 text-red-600 dark:text-red-400" />
                  </button>
                )}
              </>
            )}
          </div>
      </div>

      {menuPosition && canOpenInWorktree && (
        <div
          ref={menuRef}
          className="fixed z-50 min-w-[220px] rounded-md border border-border bg-popover p-1 shadow-lg"
          style={{ left: menuPosition.x, top: menuPosition.y }}
          onClick={(event) => event.stopPropagation()}
        >
          <div className="px-2 py-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Open in worktree
          </div>
          {worktreesForOpenIn?.map((worktree) => {
            const branchLabel = worktree.branch ?? 'detached';
            const worktreeName = worktree.path.split('/').filter(Boolean).pop() || worktree.path;
            return (
              <button
                key={worktree.path}
                className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs text-foreground hover:bg-accent"
                onClick={() => handleWorktreePick(worktree)}
              >
                <GitBranch className="h-3 w-3 flex-shrink-0 text-muted-foreground" />
                <span className="truncate" title={worktree.path}>{worktreeName}</span>
                <span className="ml-auto flex-shrink-0 text-[10px] text-muted-foreground">{branchLabel}</span>
                {worktree.isMain && (
                  <span className="flex-shrink-0 rounded bg-primary/10 px-1 py-px text-[9px] uppercase text-primary">main</span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
