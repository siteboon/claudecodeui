import { memo } from 'react';
import { useLocation } from 'react-router-dom';

import { QuickSettingsPanel } from '@/modules/quick-settings-panel';
import { useProjectSidebarState } from '@/modules/project-workspace/context/ProjectsStateContext';
import ProjectEffects from '@/modules/project-workspace/controllers/ProjectEffects';
import type { ProjectWorkspaceShellProps } from '@/shared/types';
import ProjectCommandPalette from '@/modules/project-workspace/ProjectCommandPalette';
import ProjectMainRegion from '@/modules/project-workspace/ProjectMainRegion';
import ProjectSidebarRegion from '@/modules/project-workspace/ProjectSidebarRegion';
import { useBackOpensSessionList } from '@/modules/project-workspace/hooks/useBackOpensSessionList';
import { useUiPreferences } from '@/shared/context/UiPreferencesContext';

/** Rendered by ProjectWorkspaceRoute to lay out the workspace sidebar, main region and global overlays. */
function ProjectWorkspaceShell({
  isMobile,
  ws,
  sendMessage,
  navigate,
}: ProjectWorkspaceShellProps) {
  const { key: locationKey } = useLocation();
  const { sidebarOpen, setSidebarOpen } = useProjectSidebarState();
  const { backOpensSessionList } = useUiPreferences();

  useBackOpensSessionList({
    enabled: isMobile && backOpensSessionList,
    sidebarOpen,
    setSidebarOpen,
    locationKey,
  });

  return (
    <div
      className="fixed inset-0 flex bg-background"
      style={{ bottom: 'var(--keyboard-height, 0px)' }}
    >
      <ProjectEffects navigate={navigate} />
      <ProjectSidebarRegion isMobile={isMobile} />

      <div className="flex min-w-0 flex-1 flex-col">
        <ProjectMainRegion
          isMobile={isMobile}
          ws={ws}
          sendMessage={sendMessage}
          navigate={navigate}
        />
      </div>

      <ProjectCommandPalette />
      <QuickSettingsPanel />
    </div>
  );
}

export default memo(ProjectWorkspaceShell);
