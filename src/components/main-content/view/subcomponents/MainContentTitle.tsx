import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { usePlugins } from '../../../../contexts/PluginsContext';
import type { AppTab, Project, ProjectSession } from '../../../../types/app';
import { api } from '../../../../utils/api';
import SessionProviderLogo from '../../../llm-logo-provider/SessionProviderLogo';
import { normalizeSessionTitleRename } from '../../utils/sessionTitleRename';

type MainContentTitleProps = {
  activeTab: AppTab;
  selectedProject: Project;
  selectedSession: ProjectSession | null;
  shouldShowTasksTab: boolean;
};

function getTabTitle(
  activeTab: AppTab,
  shouldShowTasksTab: boolean,
  t: (key: string) => string,
  pluginDisplayName?: string
) {
  if (activeTab.startsWith('plugin:') && pluginDisplayName) return pluginDisplayName;
  if (activeTab === 'files') return t('mainContent.projectFiles');
  if (activeTab === 'git') return t('tabs.git');
  if (activeTab === 'tasks' && shouldShowTasksTab) return 'TaskMaster';
  if (activeTab === 'browser') return t('tabs.browser');
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
}: MainContentTitleProps) {
  const { t } = useTranslation();
  const { plugins } = usePlugins();
  const pluginDisplayName = activeTab.startsWith('plugin:')
    ? plugins.find((p) => p.name === activeTab.replace('plugin:', ''))?.displayName
    : undefined;
  const showSessionIcon = activeTab === 'chat' && Boolean(selectedSession);
  const showChatNewSession = activeTab === 'chat' && !selectedSession;
  const sessionTitle = selectedSession ? getSessionTitle(selectedSession) : '';
  const [renamedSessionTitle, setRenamedSessionTitle] = useState<string | null>(null);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const displaySessionTitle = renamedSessionTitle ?? sessionTitle;

  useEffect(() => {
    setRenamedSessionTitle(null);
    setIsEditingTitle(false);
    setTitleDraft('');
  }, [selectedSession?.id]);

  const cancelTitleEdit = useCallback(() => {
    setIsEditingTitle(false);
    setTitleDraft('');
  }, []);

  const saveTitleEdit = useCallback(() => {
    if (!selectedSession) return;

    const nextTitle = normalizeSessionTitleRename(displaySessionTitle, titleDraft);
    if (!nextTitle) {
      cancelTitleEdit();
      return;
    }

    setRenamedSessionTitle(nextTitle);
    setIsEditingTitle(false);
    setTitleDraft('');
    void api.renameSession(selectedSession.id, nextTitle).then((response) => {
      if (!response.ok) {
        setRenamedSessionTitle(null);
        window.alert(t('messages.renameSessionFailed', 'Failed to rename session. Please try again.'));
      }
    }).catch((error) => {
      console.error('[MainContent] Error renaming session:', error);
      setRenamedSessionTitle(null);
      window.alert(t('messages.renameSessionError', 'Error renaming session. Please try again.'));
    });
  }, [cancelTitleEdit, displaySessionTitle, selectedSession, t, titleDraft]);

  const startTitleEdit = useCallback(() => {
    if (!selectedSession) return;
    setTitleDraft(displaySessionTitle);
    setIsEditingTitle(true);
  }, [displaySessionTitle, selectedSession]);

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
            {isEditingTitle ? (
              <input
                autoFocus
                className="h-6 w-full min-w-0 rounded border border-border bg-background px-1.5 text-sm font-semibold leading-tight text-foreground outline-none focus:border-primary"
                value={titleDraft}
                onChange={(event) => setTitleDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    saveTitleEdit();
                  } else if (event.key === 'Escape') {
                    event.preventDefault();
                    cancelTitleEdit();
                  }
                }}
                onBlur={cancelTitleEdit}
                aria-label={t('mainContent.renameSessionPrompt', 'Rename session')}
              />
            ) : (
              <h2
                title={displaySessionTitle}
                className="cursor-text truncate text-sm font-semibold leading-tight text-foreground"
                onDoubleClick={startTitleEdit}
              >
                {displaySessionTitle}
              </h2>
            )}
            <div className="truncate text-[11px] leading-tight text-muted-foreground">{selectedProject.displayName}</div>
          </div>
        ) : showChatNewSession ? (
          <div className="min-w-0">
            <h2 className="text-base font-semibold leading-tight text-foreground">{t('mainContent.newSession')}</h2>
            <div className="truncate text-xs leading-tight text-muted-foreground">{selectedProject.displayName}</div>
          </div>
        ) : (
          <div className="min-w-0">
            <h2 className="text-sm font-semibold leading-tight text-foreground">
              {getTabTitle(activeTab, shouldShowTasksTab, t, pluginDisplayName)}
            </h2>
            <div className="truncate text-[11px] leading-tight text-muted-foreground">{selectedProject.displayName}</div>
          </div>
        )}
      </div>
    </div>
  );
}
