import { useMemo } from 'react';
import ReactDOM from 'react-dom';
import { AlertTriangle, Trash2 } from 'lucide-react';
import type { TFunction } from 'i18next';
import { Button } from '../../../../shared/view/ui';
import Settings from '../../../settings/view/Settings';
import VersionUpgradeModal from '../../../version-upgrade/view';
import type { Project } from '../../../../types/app';
import type { ReleaseInfo } from '../../../../types/sharedTypes';
import type { InstallMode } from '../../../../hooks/useVersionCheck';
import { normalizeProjectForSettings } from '../../utils/utils';
import type { DeleteProjectConfirmation, SessionDeleteConfirmation, SettingsProject } from '../../types/types';
import ProjectCreationWizard from '../../../project-creation-wizard';

type SidebarModalsProps = {
  projects: Project[];
  showSettings: boolean;
  settingsInitialTab: string;
  onCloseSettings: () => void;
  showNewProject: boolean;
  onCloseNewProject: () => void;
  onProjectCreated: () => void;
  deleteConfirmation: DeleteProjectConfirmation | null;
  onCancelDeleteProject: () => void;
  onConfirmDeleteProject: () => void;
  sessionDeleteConfirmation: SessionDeleteConfirmation | null;
  onCancelDeleteSession: () => void;
  onConfirmDeleteSession: () => void;
  showVersionModal: boolean;
  onCloseVersionModal: () => void;
  releaseInfo: ReleaseInfo | null;
  currentVersion: string;
  latestVersion: string | null;
  installMode: InstallMode;
  t: TFunction;
};

type TypedSettingsProps = {
  isOpen: boolean;
  onClose: () => void;
  projects: SettingsProject[];
  initialTab: string;
};

const SettingsComponent = Settings as (props: TypedSettingsProps) => JSX.Element;

function TypedSettings(props: TypedSettingsProps) {
  return <SettingsComponent {...props} />;
}

export default function SidebarModals({
  projects,
  showSettings,
  settingsInitialTab,
  onCloseSettings,
  showNewProject,
  onCloseNewProject,
  onProjectCreated,
  deleteConfirmation,
  onCancelDeleteProject,
  onConfirmDeleteProject,
  sessionDeleteConfirmation,
  onCancelDeleteSession,
  onConfirmDeleteSession,
  showVersionModal,
  onCloseVersionModal,
  releaseInfo,
  currentVersion,
  latestVersion,
  installMode,
  t,
}: SidebarModalsProps) {
  // Settings expects project identity/path fields to be present for dropdown labels and local-scope MCP config.
  const settingsProjects = useMemo(
    () => projects.map(normalizeProjectForSettings),
    [projects],
  );

  return (
    <>
      {showNewProject &&
        ReactDOM.createPortal(
          <ProjectCreationWizard
            onClose={onCloseNewProject}
            onProjectCreated={onProjectCreated}
          />,
          document.body,
        )}

      {showSettings &&
        ReactDOM.createPortal(
          <TypedSettings
            isOpen={showSettings}
            onClose={onCloseSettings}
            projects={settingsProjects}
            initialTab={settingsInitialTab}
          />,
          document.body,
        )}

      {deleteConfirmation &&
        ReactDOM.createPortal(
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
            <div className="w-full max-w-md overflow-hidden rounded-xl border border-border bg-card shadow-2xl">
              <div className="p-6">
                <div className="flex items-start gap-4">
                  <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full bg-red-100 dark:bg-red-900/30">
                    <AlertTriangle className="h-6 w-6 text-red-600 dark:text-red-400" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="mb-2 text-lg font-semibold text-foreground">
                      {t('deleteConfirmation.deleteProject')}
                    </h3>
                    <p className="mb-1 text-sm text-muted-foreground">
                      {t('deleteConfirmation.confirmDelete')}{' '}
                      <span className="font-medium text-foreground">
                        {deleteConfirmation.project.displayName || deleteConfirmation.project.name}
                      </span>
                      ?
                    </p>
                    {deleteConfirmation.sessionCount > 0 && (
                      <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 dark:border-red-800 dark:bg-red-900/20">
                        <p className="text-sm font-medium text-red-700 dark:text-red-300">
                          {t('deleteConfirmation.sessionCount', { count: deleteConfirmation.sessionCount })}
                        </p>
                        <p className="mt-1 text-xs text-red-600 dark:text-red-400">
                          {t('deleteConfirmation.allConversationsDeleted')}
                        </p>
                      </div>
                    )}
                    <p className="mt-3 text-xs text-muted-foreground">
                      {t('deleteConfirmation.cannotUndo')}
                    </p>
                  </div>
                </div>
              </div>
              <div className="flex gap-3 border-t border-border bg-muted/30 p-4">
                <Button variant="outline" className="flex-1" onClick={onCancelDeleteProject}>
                  {t('actions.cancel')}
                </Button>
                <Button
                  variant="destructive"
                  className="flex-1 bg-red-600 text-white hover:bg-red-700"
                  onClick={onConfirmDeleteProject}
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  {t('actions.delete')}
                </Button>
              </div>
            </div>
          </div>,
          document.body,
        )}

      {sessionDeleteConfirmation &&
        ReactDOM.createPortal(
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
            <div className="w-full max-w-md overflow-hidden rounded-xl border border-border bg-card shadow-2xl">
              <div className="p-6">
                <div className="flex items-start gap-4">
                  <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full bg-red-100 dark:bg-red-900/30">
                    <AlertTriangle className="h-6 w-6 text-red-600 dark:text-red-400" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="mb-2 text-lg font-semibold text-foreground">
                      {t('deleteConfirmation.deleteSession')}
                    </h3>
                    <p className="mb-1 text-sm text-muted-foreground">
                      {t('deleteConfirmation.confirmDelete')}{' '}
                      <span className="font-medium text-foreground">
                        {sessionDeleteConfirmation.sessionTitle || t('sessions.unnamed')}
                      </span>
                      ?
                    </p>
                    <p className="mt-3 text-xs text-muted-foreground">
                      {t('deleteConfirmation.cannotUndo')}
                    </p>
                  </div>
                </div>
              </div>
              <div className="flex gap-3 border-t border-border bg-muted/30 p-4">
                <Button variant="outline" className="flex-1" onClick={onCancelDeleteSession}>
                  {t('actions.cancel')}
                </Button>
                <Button
                  variant="destructive"
                  className="flex-1 bg-red-600 text-white hover:bg-red-700"
                  onClick={onConfirmDeleteSession}
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  {t('actions.delete')}
                </Button>
              </div>
            </div>
          </div>,
          document.body,
        )}

      <VersionUpgradeModal
        isOpen={showVersionModal}
        onClose={onCloseVersionModal}
        releaseInfo={releaseInfo}
        currentVersion={currentVersion}
        latestVersion={latestVersion}
        installMode={installMode}
      />
    </>
  );
}
