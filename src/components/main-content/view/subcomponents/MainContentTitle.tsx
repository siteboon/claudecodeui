import { useTranslation } from 'react-i18next';

import SessionProviderLogo from '../../../llm-logo-provider/SessionProviderLogo';
import type { AppTab, Project, ProjectSession } from '../../../../types/app';
import { usePlugins } from '../../../../contexts/PluginsContext';

type MainContentTitleProps = {
  activeTab: AppTab;
  selectedProject: Project;
  selectedSession: ProjectSession | null;
  shouldShowTasksTab: boolean;
  shouldLabelBrowserTabAsCobrowse: boolean;
};

function getTabTitle(
  activeTab: AppTab,
  shouldShowTasksTab: boolean,
  shouldLabelBrowserTabAsCobrowse: boolean,
  t: (key: string) => string,
  coBrowseLabel: string,
  pluginDisplayName?: string,
) {
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
    if (shouldLabelBrowserTabAsCobrowse) {
      return coBrowseLabel;
    }
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

export default function MainContentTitle({
  activeTab,
  selectedProject,
  selectedSession,
  shouldShowTasksTab,
  shouldLabelBrowserTabAsCobrowse,
}: MainContentTitleProps) {
  const { t } = useTranslation();
  const { plugins } = usePlugins();
  const coBrowseLabel = t('tabs.coBrowse', { defaultValue: 'Co-browse' });

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
            <h2 title={getSessionTitle(selectedSession)} className="truncate text-sm font-semibold leading-tight text-foreground">
              {getSessionTitle(selectedSession)}
            </h2>
            <div className="flex min-w-0 items-center gap-2 text-[11px] leading-tight text-muted-foreground">
              <span className="min-w-0 truncate">{selectedProject.displayName}</span>
              <span
                className="hidden min-w-0 max-w-[45%] flex-shrink truncate border-l border-border/60 pl-2 font-mono text-[10px] sm:block"
                title={selectedSession.id}
              >
                {selectedSession.id}
              </span>
            </div>
          </div>
        ) : showChatNewSession ? (
          <div className="min-w-0">
            <h2 className="text-base font-semibold leading-tight text-foreground">{t('mainContent.newSession')}</h2>
            <div className="truncate text-xs leading-tight text-muted-foreground">{selectedProject.displayName}</div>
          </div>
        ) : (
          <div className="min-w-0">
            <h2 className="text-sm font-semibold leading-tight text-foreground">
              {getTabTitle(activeTab, shouldShowTasksTab, shouldLabelBrowserTabAsCobrowse, t, coBrowseLabel, pluginDisplayName)}
            </h2>
            <div className="truncate text-[11px] leading-tight text-muted-foreground">{selectedProject.displayName}</div>
          </div>
        )}
      </div>
    </div>
  );
}
