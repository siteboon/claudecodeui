import { memo } from 'react';

import { useProjectCommandState } from '../../../contexts/ProjectsStateContext';
import CommandPalette from '../../command-palette/CommandPalette';

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
