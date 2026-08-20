import { memo } from 'react';

import { useProjectCommandState } from '@/modules/project-workspace/context/ProjectsStateContext';
import { CommandPalette } from '@/modules/command-palette';

function ProjectCommandPalette() {
  const {
    selectedProject,
    handleNewSession,
    openSettings,
    setActiveTab,
  } = useProjectCommandState();

  return (
    <CommandPalette
      selectedProject={selectedProject}
      onStartNewChat={handleNewSession}
      onOpenSettings={openSettings}
      onShowTab={setActiveTab}
    />
  );
}

export default memo(ProjectCommandPalette);
