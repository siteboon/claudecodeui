import { GitBranch } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import SessionProviderLogo from '../../../llm-logo-provider/SessionProviderLogo';
import type { AppTab, Project, ProjectSession } from '../../../../types/app';
import { usePlugins } from '../../../../contexts/PluginsContext';
import { useSessionRepoInfo } from '../../hooks/useSessionRepoInfo';

type MainContentTitleProps = {
  activeTab: AppTab;
  selectedProject: Project;
  selectedSession: ProjectSession | null;
  shouldShowTasksTab: boolean;
};

function getTabTitle(activeTab: AppTab, shouldShowTasksTab: boolean, t: (key: string) => string, pluginDisplayName?: string) {
  if (activeTab.startsWith('plugin:') && pluginDisplayName) {
    return pluginDisplayName;
  }

  if (activeTab === 'files') {
    return t('mainContent.projectFiles');
  }

  if (activeTab === 'git') {
    return t('tabs.git');
  }

  if (activeTab === 'tasks' && shouldShowTasksTab) {
    return 'TaskMaster';
  }

  if (activeTab === 'browser') {
    return t('tabs.browser');
  }

  return 'Project';
}

function getSessionTitle(session: ProjectSession): string {
  if (session.__provider === 'cursor') {
    return (session.name as string) || 'Untitled Session';
  }

  return (session.summary as string) || 'New Session';
}

/**
 * Right-aligned "<repo> · <branch>" for the subtitle line. Reads git info
 * (read-only) for the session's working directory; for a worktree the repo is
 * the originating repository. Renders nothing until resolved, and a subtle
 * hint when the directory is not a git repo.
 */
function RepoBranchBadge({ projectId }: { projectId: string | null | undefined }) {
  const { t } = useTranslation();
  const { repo, branch, isGitRepo, loading } = useSessionRepoInfo(projectId);

  if (loading && !repo) {
    return null;
  }

  if (!isGitRepo) {
    return (
      <span className="flex-shrink-0 whitespace-nowrap text-[11px] italic leading-tight text-muted-foreground/50">
        {t('mainContent.notAGitRepo', { defaultValue: 'not a git repo' })}
      </span>
    );
  }

  return (
    <span className="flex min-w-0 flex-shrink items-center gap-1 whitespace-nowrap text-[11px] leading-tight text-muted-foreground/80">
      <GitBranch className="h-3 w-3 flex-shrink-0" />
      {repo && <span className="truncate font-medium">{repo}</span>}
      {repo && branch && <span className="text-muted-foreground/40">·</span>}
      {branch && <span className="truncate">{branch}</span>}
    </span>
  );
}

export default function MainContentTitle({
  activeTab,
  selectedProject,
  selectedSession,
  shouldShowTasksTab,
}: MainContentTitleProps) {
  const { t } = useTranslation();
  const { plugins } = usePlugins();

  const pluginDisplayName = activeTab.startsWith('plugin:')
    ? plugins.find((p) => p.name === activeTab.replace('plugin:', ''))?.displayName
    : undefined;

  const showSessionIcon = activeTab === 'chat' && Boolean(selectedSession);
  const showChatNewSession = activeTab === 'chat' && !selectedSession;

  return (
    <div className="scrollbar-hide flex min-w-0 flex-1 items-center gap-2 overflow-x-auto">
      {showSessionIcon && (
        <div className="flex h-5 w-5 flex-shrink-0 items-center justify-center">
          <SessionProviderLogo provider={selectedSession?.__provider} className="h-4 w-4" />
        </div>
      )}

      <div className="min-w-0 flex-1">
        {activeTab === 'chat' && selectedSession ? (
          <div className="min-w-0">
            <h2 className="scrollbar-hide overflow-x-auto whitespace-nowrap text-sm font-semibold leading-tight text-foreground">
              {getSessionTitle(selectedSession)}
            </h2>
            <div className="flex items-center justify-between gap-3">
              <span className="truncate text-[11px] leading-tight text-muted-foreground">{selectedProject.displayName}</span>
              <RepoBranchBadge projectId={selectedProject.projectId} />
            </div>
          </div>
        ) : showChatNewSession ? (
          <div className="min-w-0">
            <h2 className="text-base font-semibold leading-tight text-foreground">{t('mainContent.newSession')}</h2>
            <div className="flex items-center justify-between gap-3">
              <span className="truncate text-xs leading-tight text-muted-foreground">{selectedProject.displayName}</span>
              <RepoBranchBadge projectId={selectedProject.projectId} />
            </div>
          </div>
        ) : (
          <div className="min-w-0">
            <h2 className="text-sm font-semibold leading-tight text-foreground">
              {getTabTitle(activeTab, shouldShowTasksTab, t, pluginDisplayName)}
            </h2>
            <div className="flex items-center justify-between gap-3">
              <span className="truncate text-[11px] leading-tight text-muted-foreground">{selectedProject.displayName}</span>
              <RepoBranchBadge projectId={selectedProject.projectId} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
