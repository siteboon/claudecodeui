import { Star, MessageSquare } from 'lucide-react';
import type { TFunction } from 'i18next';

import { cn } from '../../../../lib/utils';
import type { Project, LLMProvider } from '../../../../types/app';
import type { SessionWithProvider } from '../../types/types';
import { useStarredSessions } from '../../../../hooks/useStarredSessions';
import { getAllSessions } from '../../utils/utils';
import SessionProviderLogo from '../../../llm-logo-provider/SessionProviderLogo';

type StarredEntry = {
  session: SessionWithProvider;
  project: Project;
};

type SidebarStarredViewProps = {
  projects: Project[];
  searchFilter: string;
  onProjectSelect: (project: Project) => void;
  onSessionSelect: (session: SessionWithProvider, projectId: string) => void;
  t: TFunction;
};

function collectStarredEntries(projects: Project[], starredIds: Set<string>): StarredEntry[] {
  // Sessions can show up under more than one project + worktree if the same
  // directory is registered multiple ways (worktree + its standalone project,
  // or a project with a custom display name). De-dup globally by session id.
  const entries: StarredEntry[] = [];
  const seen = new Set<string>();

  const consider = (session: SessionWithProvider, project: Project) => {
    if (!starredIds.has(session.id) || seen.has(session.id)) return;
    seen.add(session.id);
    entries.push({ session, project });
  };

  for (const project of projects) {
    for (const session of getAllSessions(project)) {
      consider(session, project);
    }
    for (const worktree of project.worktrees ?? []) {
      const worktreeView: Project = {
        ...project,
        path: worktree.path,
        fullPath: worktree.path,
        sessions: worktree.sessions,
        cursorSessions: worktree.cursorSessions,
        codexSessions: worktree.codexSessions,
        geminiSessions: worktree.geminiSessions,
      };
      for (const session of getAllSessions(worktreeView)) {
        consider(session, worktreeView);
      }
    }
  }

  return entries.sort((a, b) => {
    const aDate = new Date(String(a.session.lastActivity ?? a.session.updated_at ?? 0)).getTime();
    const bDate = new Date(String(b.session.lastActivity ?? b.session.updated_at ?? 0)).getTime();
    return bDate - aDate;
  });
}

export default function SidebarStarredView({
  projects,
  searchFilter,
  onProjectSelect,
  onSessionSelect,
  t,
}: SidebarStarredViewProps) {
  const { starredIds, toggle } = useStarredSessions();
  const entries = collectStarredEntries(projects, starredIds);

  const filterText = searchFilter.trim().toLowerCase();
  const visibleEntries = filterText
    ? entries.filter((entry) => {
        const title = String(entry.session.summary ?? entry.session.title ?? entry.session.name ?? '').toLowerCase();
        const projectName = entry.project.displayName.toLowerCase();
        return title.includes(filterText) || projectName.includes(filterText);
      })
    : entries;

  if (visibleEntries.length === 0) {
    return (
      <div className="px-4 py-12 text-center md:py-8">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-muted md:mb-3">
          <Star className="h-6 w-6 text-muted-foreground" />
        </div>
        <h3 className="mb-2 text-base font-medium text-foreground md:mb-1">
          {entries.length === 0 ? 'No starred sessions' : 'No matches'}
        </h3>
        <p className="text-sm text-muted-foreground">
          {entries.length === 0
            ? 'Hover any session in the sidebar and click the star icon to add it here.'
            : 'Try a different search term.'}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-1 px-2">
      <div className="px-1 pb-1 pt-2">
        <p className="text-xs text-muted-foreground">
          {visibleEntries.length} starred session{visibleEntries.length === 1 ? '' : 's'}
        </p>
      </div>

      {visibleEntries.map(({ session, project }) => {
        const sessionTitle = String(
          session.summary || session.title || session.name || session.id,
        );
        const lastActivity = String(session.lastActivity ?? session.updated_at ?? '');
        const provider = session.__provider as LLMProvider;
        return (
          <div
            key={session.id}
            className={cn(
              'group flex w-full items-start gap-2 rounded-md border border-border/40 bg-card p-2 transition-colors hover:border-border hover:bg-accent/30',
            )}
          >
            <button
              className="flex h-5 w-5 flex-shrink-0 items-center justify-center text-yellow-500 hover:text-yellow-600 dark:text-yellow-400 dark:hover:text-yellow-300"
              onClick={(event) => {
                event.stopPropagation();
                toggle(session.id);
              }}
              title="Unstar"
              aria-label="Unstar session"
            >
              <Star className="h-3.5 w-3.5 fill-current" />
            </button>
            <button
              className="min-w-0 flex-1 text-left"
              onClick={() => {
                onProjectSelect(project);
                onSessionSelect(session, project.projectId);
              }}
            >
              <div className="flex items-center gap-1.5">
                <SessionProviderLogo provider={provider} className="h-3 w-3 flex-shrink-0" />
                <span className="truncate text-xs font-medium text-foreground" title={sessionTitle}>
                  {sessionTitle || t('sessions.untitledSession', 'Untitled session')}
                </span>
              </div>
              <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground">
                <MessageSquare className="h-2.5 w-2.5 flex-shrink-0" />
                <span className="truncate" title={project.displayName}>
                  {project.displayName}
                </span>
                {lastActivity && (
                  <span className="ml-auto flex-shrink-0">
                    {new Date(lastActivity).toLocaleDateString()}
                  </span>
                )}
              </div>
            </button>
          </div>
        );
      })}
    </div>
  );
}
