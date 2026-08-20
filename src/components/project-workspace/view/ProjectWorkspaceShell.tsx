import { memo } from 'react';

import { QuickSettingsPanel } from '../../quick-settings-panel';
import ProjectEffects from '../controllers/ProjectEffects';
import QueuedMessageAutoSendController from '../controllers/QueuedMessageAutoSendController';
import type { ProjectWorkspaceShellProps } from '../types';

import ProjectCommandPalette from './ProjectCommandPalette';
import ProjectMainRegion from './ProjectMainRegion';
import ProjectSidebarRegion from './ProjectSidebarRegion';

function ProjectWorkspaceShell({
  isMobile,
  ws,
  sendMessage,
  navigate,
}: ProjectWorkspaceShellProps) {
  return (
    <div
      className="fixed inset-0 flex bg-background"
      style={{ bottom: 'var(--keyboard-height, 0px)' }}
    >
      <ProjectEffects navigate={navigate} />
      <QueuedMessageAutoSendController ws={ws} sendMessage={sendMessage} />
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
