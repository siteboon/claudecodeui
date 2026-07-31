import { type ReactNode } from 'react';
import { Activity, Archive, Folder, MessageSquare, RotateCcw, Search, Trash2 } from 'lucide-react';
import type { TFunction } from 'i18next';

import { ScrollArea } from '../../../../shared/view/ui';
import type { Project } from '../../../../types/app';
import type { ReleaseInfo } from '../../../../types/sharedTypes';
import type { ConversationSearchResults, SearchProgress } from '../../hooks/useSidebarController';
import type { ArchivedProjectListItem, ArchivedSessionListItem, SidebarSearchMode } from '../../types/types';
import SessionProviderLogo from '../../../llm-logo-provider/SessionProviderLogo';
import { getAllSessions } from '../../utils/utils';

import SidebarFooter from './SidebarFooter';
import SidebarHeader from './SidebarHeader';
import SidebarProjectList, { type SidebarProjectListProps } from './SidebarProjectList';

function HighlightedSnippet({ snippet, highlights }: { snippet: string; highlights: { start: number; end: number }[] }) {
  const parts: ReactNode[] = [];
  let cursor = 0;
  for (const h of highlights) {
    if (h.start > cursor) {
      parts.push(snippet.slice(cursor, h.start));
    }
    parts.push(
      <mark key={h.start} className="rounded-sm bg-yellow-200 px-0.5 text-foreground dark:bg-yellow-800">
        {snippet.slice(h.start, h.end)}
      </mark>
    );
    cursor = h.end;
  }
  if (cursor < snippet.length) {
    parts.push(snippet.slice(cursor));
  }
  return (
    <span className="min-w-0 flex-1 break-words text-xs leading-relaxed text-muted-foreground">
      {parts}
    </span>
  );
}

type ArchivedSessionGroup = {
  key: string;
  projectId: string | null;
  projectDisplayName: string;
  projectPath: string | null;
  isProjectArchived: boolean;
  sessions: ArchivedSessionListItem[];
  latestActivity: string | null;
};

/**
 * Groups archived sessions by project metadata so the archive view preserves
 * the same mental model as the active sidebar: projects first, then sessions.
 */
function groupArchivedSessionsByProject(sessions: ArchivedSessionListItem[]): ArchivedSessionGroup[] {
  const groups = new Map<string, ArchivedSessionGroup>();

  for (const session of sessions) {
    const key = session.projectId ?? session.projectPath ?? `session:${session.sessionId}`;
    const existingGroup = groups.get(key);

    if (existingGroup) {
      existingGroup.sessions.push(session);
      if (!existingGroup.latestActivity || (session.lastActivity && session.lastActivity > existingGroup.latestActivity)) {
        existingGroup.latestActivity = session.lastActivity;
      }
      continue;
    }

    groups.set(key, {
      key,
      projectId: session.projectId,
      projectDisplayName: session.projectDisplayName,
      projectPath: session.projectPath,
      isProjectArchived: session.isProjectArchived,
      sessions: [session],
      latestActivity: session.lastActivity,
    });
  }

  return [...groups.values()].sort((groupA, groupB) => {
    const a = groupA.latestActivity ?? '';
    const b = groupB.latestActivity ?? '';
    return b.localeCompare(a);
  });
}

function formatCompactArchivedAge(dateString: string | null): string {
  if (!dateString) {
    return '';
  }

  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) {
    return '';
  }

  const diffInMinutes = Math.floor(Math.max(0, Date.now() - date.getTime()) / (1000 * 60));
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

  return `${Math.floor(diffInHours / 24)}d`;
}

type SidebarContentProps = {
  isPWA: boolean;
  isMobile: boolean;
  isLoading: boolean;
  projects: Project[];
  runningSessionsCount: number;
  archivedProjects: ArchivedProjectListItem[];
  archivedSessions: ArchivedSessionListItem[];
  archivedSessionsCount: number;
  isArchivedSessionsLoading: boolean;
  searchFilter: string;
  onSearchFilterChange: (value: string) => void;
  onClearSearchFilter: () => void;
  searchMode: SidebarSearchMode;
  onSearchModeChange: (mode: SidebarSearchMode) => void;
  conversationResults: ConversationSearchResults | null;
  isSearching: boolean;
  searchProgress: SearchProgress | null;
  onRestoreArchivedProject: (projectId: string) => void;
  onArchivedSessionClick: (session: ArchivedSessionListItem) => void;
  onRestoreArchivedSession: (sessionId: string) => void;
  onDeleteArchivedSession: (session: ArchivedSessionListItem) => void;
  // Conversation result clicks pass back the DB projectId (or null when the
  // server couldn't resolve it). Consumers must handle the null case.
  onConversationResultClick: (projectId: string | null, sessionId: string, provider: string, messageTimestamp?: string | null, messageSnippet?: string | null) => void;
  onRefresh: () => void;
  isRefreshing: boolean;
  onCreateProject: () => void;
  onCollapseSidebar: () => void;
  updateAvailable: boolean;
  restartRequired: boolean;
  releaseInfo: ReleaseInfo | null;
  latestVersion: string | null;
  currentVersion: string;
  onShowVersionModal: () => void;
  onShowSettings: () => void;
  projectListProps: SidebarProjectListProps;
  t: TFunction;
};

export default function SidebarContent({
  isPWA,
  isMobile,
  isLoading,
  projects,
  runningSessionsCount,
  archivedProjects,
  archivedSessions,
  archivedSessionsCount,
  isArchivedSessionsLoading,
  searchFilter,
  onSearchFilterChange,
  onClearSearchFilter,
  searchMode,
  onSearchModeChange,
  conversationResults,
  isSearching,
  searchProgress,
  onRestoreArchivedProject,
  onArchivedSessionClick,
  onRestoreArchivedSession,
  onDeleteArchivedSession,
  onConversationResultClick,
  onRefresh,
  isRefreshing,
  onCreateProject,
  onCollapseSidebar,
  updateAvailable,
  restartRequired,
  releaseInfo,
  latestVersion,
  currentVersion,
  onShowVersionModal,
  onShowSettings,
  projectListProps,
  t,
}: SidebarContentProps) {
  const showConversationSearch = searchMode === 'conversations' && searchFilter.trim().length >= 2;
  const hasPartialResults = conversationResults && conversationResults.results.length > 0;
  const groupedArchivedSessions = groupArchivedSessionsByProject(archivedSessions);
  const visibleArchivedItemsCount = archivedProjects.length + archivedSessions.length;
  const isRenamingOnMobile = isMobile && Boolean(
    projectListProps.editingProject || projectListProps.editingSession,
  );

  return (
    <div
      className="flex h-full flex-col bg-background/80 backdrop-blur-sm md:w-72 md:select-none"
      style={{}}
    >
      <SidebarHeader
        isPWA={isPWA}
        isMobile={isMobile}
        isLoading={isLoading}
        projectsCount={projects.length}
        runningSessionsCount={runningSessionsCount}
        archivedSessionsCount={archivedSessionsCount}
        isArchivedSessionsLoading={isArchivedSessionsLoading}
        searchFilter={searchFilter}
        onSearchFilterChange={onSearchFilterChange}
        onClearSearchFilter={onClearSearchFilter}
        searchMode={searchMode}
        onSearchModeChange={onSearchModeChange}
        onRefresh={onRefresh}
        isRefreshing={isRefreshing}
        onCreateProject={onCreateProject}
        onCollapseSidebar={onCollapseSidebar}
        t={t}
      />

      <ScrollArea className="flex-1 overflow-y-auto overscroll-contain md:px-1.5 md:py-2">
        {showConversationSearch ? (
          isSearching && !hasPartialResults ? (
            <div className="px-4 py-12 text-center md:py-8">
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-muted md:mb-3">
                <div className="h-6 w-6 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
              </div>
              <p className="text-sm text-muted-foreground">{t('search.searching')}</p>
              {searchProgress && (
                <p className="mt-1 text-xs text-muted-foreground/60">
                  {t('search.projectsScanned', { count: searchProgress.scannedProjects })}/{searchProgress.totalProjects}
                </p>
              )}
            </div>
          ) : !isSearching && conversationResults && conversationResults.results.length === 0 ? (
            <div className="px-4 py-12 text-center md:py-8">
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-muted md:mb-3">
                <Search className="h-6 w-6 text-muted-foreground" />
              </div>
              <h3 className="mb-2 text-base font-medium text-foreground md:mb-1">{t('search.noResults')}</h3>
              <p className="text-sm text-muted-foreground">{t('search.tryDifferentQuery')}</p>
            </div>
          ) : hasPartialResults ? (
            <div className="space-y-3 px-2">
              <div className="flex items-center justify-between px-1">
                <p className="text-xs text-muted-foreground">
                  {t('search.matches', { count: conversationResults.totalMatches })}
                </p>
                {isSearching && searchProgress && (
                  <div className="flex items-center gap-1.5">
                    <div className="h-3 w-3 animate-spin rounded-full border-[1.5px] border-muted-foreground/40 border-t-primary" />
                    <p className="text-[10px] text-muted-foreground/60">
                      {searchProgress.scannedProjects}/{searchProgress.totalProjects}
                    </p>
                  </div>
                )}
              </div>
              {isSearching && searchProgress && (
                <div className="mx-1 h-0.5 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary/60 transition-all duration-300"
                    style={{ width: `${Math.round((searchProgress.scannedProjects / searchProgress.totalProjects) * 100)}%` }}
                  />
                </div>
              )}
              {conversationResults.results.map((projectResult) => (
                <div key={projectResult.projectName} className="space-y-1">
                  <div className="flex items-center gap-1.5 px-1 py-1">
                    <Folder className="h-3 w-3 flex-shrink-0 text-muted-foreground" />
                    <span className="truncate text-xs font-normal text-foreground">
                      {projectResult.projectDisplayName}
                    </span>
                  </div>
                  {projectResult.sessions.map((session) => (
                    <button
                      key={`${projectResult.projectId ?? projectResult.projectName}-${session.sessionId}`}
                      className="w-full rounded-md px-2 py-2 text-left transition-colors hover:bg-accent/50"
                      onClick={() => onConversationResultClick(
                        // Pass the DB projectId (preferred) so the parent can
                        // cross-reference with the loaded projects list.
                        projectResult.projectId,
                        session.sessionId,
                        session.provider || session.matches[0]?.provider || 'claude',
                        session.matches[0]?.timestamp,
                        session.matches[0]?.snippet
                      )}
                    >
                      <div className="mb-1 flex items-center gap-1.5">
                        <MessageSquare className="h-3 w-3 flex-shrink-0 text-primary" />
                        <span className="truncate text-xs font-normal text-foreground">
                          {session.sessionSummary}
                        </span>
                        {session.provider && session.provider !== 'claude' && (
                          <span className="flex-shrink-0 rounded bg-muted px-1 py-0.5 text-[9px] uppercase text-muted-foreground">
                            {session.provider}
                          </span>
                        )}
                      </div>
                      <div className="space-y-1 pl-4">
                        {session.matches.map((match, idx) => (
                          <div key={idx} className="flex items-start gap-1">
                            <span className="mt-0.5 flex-shrink-0 text-[10px] font-normal uppercase text-muted-foreground/60">
                              {match.role === 'user' ? 'U' : 'A'}
                            </span>
                            <HighlightedSnippet
                              snippet={match.snippet}
                              highlights={match.highlights}
                            />
                          </div>
                        ))}
                      </div>
                    </button>
                  ))}
                </div>
              ))}
            </div>
          ) : null
        ) : searchMode === 'running' ? (
          projectListProps.filteredProjects.length === 0 ? (
            <div className="px-4 py-12 text-center md:py-8">
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-lg border border-border/70 bg-muted/50 md:mb-3">
                <Activity className="h-6 w-6 text-muted-foreground" />
              </div>
              <h3 className="mb-2 text-base font-medium text-foreground md:mb-1">
                {t('running.emptyTitle', 'No sessions running')}
              </h3>
              <p className="text-sm text-muted-foreground">
                {runningSessionsCount > 0
                  ? t('running.noMatchingSessions', 'No running sessions match this search.')
                  : t('running.emptyDescription', 'Active work will appear here while a provider is processing.')}
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="mx-2 flex items-center justify-between rounded-lg border border-border/60 bg-card/50 px-3 py-2 shadow-sm">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="flex h-6 w-6 items-center justify-center rounded-md bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                    <Activity className="h-3.5 w-3.5" />
                  </span>
                  <span className="truncate text-xs font-normal text-foreground">
                    {t('running.title', 'Running now')}
                  </span>
                </div>
                <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-normal text-emerald-700 dark:text-emerald-300">
                  {runningSessionsCount}
                </span>
              </div>
              <SidebarProjectList {...projectListProps} />
            </div>
          )
        ) : searchMode === 'archived' ? (
          isArchivedSessionsLoading ? (
            <div className="space-y-2 px-2 py-1" aria-live="polite" aria-busy="true">
              <div className="flex items-center gap-2 px-1 py-2">
                <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-muted/70">
                  <div className="h-3.5 w-3.5 animate-spin rounded-full border-[1.5px] border-muted-foreground/40 border-t-muted-foreground" />
                </div>
                <div>
                  <h3 className="text-xs font-medium text-foreground">
                    {t('archived.loadingTitle', 'Loading archive...')}
                  </h3>
                  <p className="text-[11px] text-muted-foreground">
                    {t('archived.loadingDescription', 'Fetching hidden workspaces and sessions you can restore later.')}
                  </p>
                </div>
              </div>
              {[0, 1].map((skeleton) => (
                <div key={skeleton} className="animate-pulse rounded-xl border border-border/50 bg-card/40 p-3">
                  <div className="flex items-center gap-2.5">
                    <div className="h-8 w-8 rounded-lg bg-muted" />
                    <div className="min-w-0 flex-1 space-y-2">
                      <div className="h-3 w-2/3 rounded bg-muted" />
                      <div className="h-2.5 w-5/6 rounded bg-muted/70" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : archivedProjects.length === 0 && groupedArchivedSessions.length === 0 ? (
            <div className="px-3 py-8 text-center">
              <div className="mx-auto max-w-[240px] rounded-2xl border border-dashed border-border/80 bg-muted/20 px-5 py-7">
                <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-xl border border-border/70 bg-background shadow-sm">
                  <Archive className="h-[18px] w-[18px] text-muted-foreground" />
                </div>
                <h3 className="text-sm font-medium text-foreground">
                  {archivedSessionsCount > 0
                    ? t('archived.noMatchingSessions', 'No matching archived items')
                    : t('archived.emptyTitle', 'No archived items')}
                </h3>
                <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                  {archivedSessionsCount > 0
                    ? t('archived.tryDifferentSearch', 'Try a different search term.')
                    : t('archived.emptyDescription', 'Archived workspaces and sessions will appear here when you hide them from the active list.')}
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-2.5 px-2 pb-3">
              <div className="flex items-center justify-between px-1 pb-0.5 pt-0.5">
                <div className="flex items-center gap-2">
                  <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-muted/60 text-muted-foreground">
                    <Archive className="h-3.5 w-3.5" />
                  </span>
                  <div>
                    <h2 className="text-xs font-medium leading-none text-foreground">
                      {t('archived.title', 'Archive')}
                    </h2>
                    <p className="mt-1 text-[10px] leading-none text-muted-foreground">
                      {t('archived.restoreHint', 'Restore items whenever you need them')}
                    </p>
                  </div>
                </div>
                <span
                  className="rounded-full border border-border/60 bg-muted/40 px-2 py-0.5 text-[10px] tabular-nums text-muted-foreground"
                  title={visibleArchivedItemsCount !== archivedSessionsCount
                    ? `${visibleArchivedItemsCount} of ${archivedSessionsCount}`
                    : undefined}
                >
                  {visibleArchivedItemsCount !== archivedSessionsCount
                    ? `${visibleArchivedItemsCount}/${archivedSessionsCount}`
                    : archivedSessionsCount}
                </span>
              </div>
              {archivedProjects.map((project) => {
                const projectSessions = getAllSessions(project);

                return (
                  <section
                    key={project.projectId}
                    className="group/archive overflow-hidden rounded-xl border border-border/70 bg-card/45 shadow-[0_1px_0_hsl(var(--border)/0.2)] transition-colors hover:border-border"
                  >
                    <div className="flex items-center gap-2.5 px-2.5 py-2.5">
                      <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg border border-border/60 bg-muted/45 text-muted-foreground">
                        <Folder className="h-4 w-4" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex min-w-0 items-center gap-1.5">
                          <h3 className="truncate text-[13px] font-medium text-foreground">
                            {project.displayName}
                          </h3>
                          {projectSessions.length > 0 && (
                            <span className="flex-shrink-0 rounded-md bg-muted/60 px-1.5 py-0.5 text-[9px] tabular-nums text-muted-foreground">
                              {projectSessions.length}
                            </span>
                          )}
                        </div>
                        <p className="mt-0.5 truncate text-[11px] text-muted-foreground/70" title={project.fullPath}>
                          {project.fullPath}
                        </p>
                      </div>
                      <button
                        className="flex h-7 flex-shrink-0 items-center gap-1.5 rounded-lg border border-emerald-600/15 bg-emerald-500/10 px-2 text-[10px] font-medium text-emerald-700 transition-all hover:border-emerald-600/25 hover:bg-emerald-500/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40 dark:text-emerald-300"
                        onClick={() => onRestoreArchivedProject(project.projectId)}
                        title={t('archived.restoreProject', 'Restore workspace')}
                        aria-label={`${t('archived.restoreProject', 'Restore workspace')}: ${project.displayName}`}
                      >
                        <RotateCcw className="h-3 w-3" />
                        {t('archived.restoreAction', 'Restore')}
                      </button>
                    </div>
                    {projectSessions.length > 0 && (
                      <div className="border-t border-border/45 bg-muted/[0.08]">
                        {projectSessions.map((session) => (
                          <button
                            key={String(session.id)}
                            className="flex w-full items-center gap-2.5 border-b border-border/35 px-2.5 py-2 text-left transition-colors last:border-b-0 hover:bg-accent/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                            onClick={() => onArchivedSessionClick({
                              sessionId: String(session.id),
                              provider: session.__provider,
                              projectId: project.projectId,
                              projectPath: project.fullPath,
                              projectDisplayName: project.displayName,
                              sessionTitle:
                                (typeof session.summary === 'string' && session.summary.trim().length > 0
                                  ? session.summary
                                  : typeof session.name === 'string' && session.name.trim().length > 0
                                    ? session.name
                                    : String(session.id)),
                              createdAt: typeof session.created_at === 'string' ? session.created_at : null,
                              updatedAt: typeof session.updated_at === 'string' ? session.updated_at : null,
                              lastActivity:
                                typeof session.lastActivity === 'string'
                                  ? session.lastActivity
                                  : typeof session.updated_at === 'string'
                                    ? session.updated_at
                                    : typeof session.created_at === 'string'
                                      ? session.created_at
                                      : null,
                              isProjectArchived: true,
                            })}
                          >
                            <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md bg-background/70">
                              <SessionProviderLogo provider={session.__provider} className="h-3.5 w-3.5" />
                            </span>
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-xs text-foreground">
                                {(typeof session.summary === 'string' && session.summary.trim().length > 0
                                  ? session.summary
                                  : typeof session.name === 'string' && session.name.trim().length > 0
                                    ? session.name
                                    : String(session.id))}
                              </p>
                              <div className="mt-0.5 flex items-center gap-1 text-[10px] text-muted-foreground/70">
                                <span className="uppercase tracking-wide">{session.__provider}</span>
                                <span aria-hidden>·</span>
                                <span className="tabular-nums">
                                  {formatCompactArchivedAge(
                                    typeof session.lastActivity === 'string'
                                      ? session.lastActivity
                                      : typeof session.updated_at === 'string'
                                        ? session.updated_at
                                        : typeof session.created_at === 'string'
                                          ? session.created_at
                                          : null,
                                  )}
                                </span>
                              </div>
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </section>
                );
              })}
              {groupedArchivedSessions.map((group) => (
                <section
                  key={group.key}
                  className="group/archive overflow-hidden rounded-xl border border-border/70 bg-card/45 shadow-[0_1px_0_hsl(var(--border)/0.2)] transition-colors hover:border-border"
                >
                  <div className="flex items-center gap-2.5 px-2.5 py-2.5">
                    <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg border border-border/60 bg-muted/45 text-muted-foreground">
                      <Folder className="h-4 w-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 items-center gap-1.5">
                        <h3 className="truncate text-[13px] font-medium text-foreground">
                          {group.projectDisplayName}
                        </h3>
                        <span className="flex-shrink-0 rounded-md bg-muted/60 px-1.5 py-0.5 text-[9px] tabular-nums text-muted-foreground">
                          {group.sessions.length}
                        </span>
                      </div>
                      {group.projectPath && (
                        <p className="mt-0.5 truncate text-[11px] text-muted-foreground/70" title={group.projectPath}>
                          {group.projectPath}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="border-t border-border/45 bg-muted/[0.08]">
                    {group.sessions.map((session) => (
                      <div
                        key={session.sessionId}
                        className="group/session flex items-center gap-1 border-b border-border/35 px-2.5 py-2 last:border-b-0 hover:bg-accent/35"
                      >
                        <button
                          className="flex min-w-0 flex-1 items-center gap-2.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          onClick={() => onArchivedSessionClick(session)}
                        >
                          <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md bg-background/70">
                            <SessionProviderLogo provider={session.provider} className="h-3.5 w-3.5" />
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-xs text-foreground">
                              {session.sessionTitle}
                            </p>
                            <div className="mt-0.5 flex items-center gap-1 text-[10px] text-muted-foreground/70">
                              <span className="uppercase tracking-wide">{session.provider}</span>
                              {session.lastActivity && (
                                <>
                                  <span aria-hidden>·</span>
                                  <span className="tabular-nums">{formatCompactArchivedAge(session.lastActivity)}</span>
                                </>
                              )}
                            </div>
                          </div>
                        </button>
                        <div className="flex flex-shrink-0 items-center gap-0.5">
                          <button
                            className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-emerald-500/10 hover:text-emerald-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40 dark:hover:text-emerald-300"
                            onClick={() => onRestoreArchivedSession(session.sessionId)}
                            title={t('archived.restore', 'Restore session')}
                            aria-label={`${t('archived.restore', 'Restore session')}: ${session.sessionTitle}`}
                          >
                            <RotateCcw className="h-3.5 w-3.5" />
                          </button>
                          <button
                            className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground/60 transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive/40"
                            onClick={() => onDeleteArchivedSession(session)}
                            title={t('archived.deletePermanently', 'Delete permanently')}
                            aria-label={`${t('archived.deletePermanently', 'Delete permanently')}: ${session.sessionTitle}`}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          )
        ) : (
          <SidebarProjectList {...projectListProps} />
        )}
      </ScrollArea>

      {!isRenamingOnMobile && (
        <SidebarFooter
          updateAvailable={updateAvailable}
          restartRequired={restartRequired}
          releaseInfo={releaseInfo}
          latestVersion={latestVersion}
          currentVersion={currentVersion}
          onShowVersionModal={onShowVersionModal}
          onShowSettings={onShowSettings}
          t={t}
        />
      )}
    </div>
  );
}
