import { useState } from 'react';

/**
 * Hook layer (The Manager)
 * Manages the open/close states of various sidebar modals.
 */
export const useSidebarModals = () => {
  const [showNewProject, setShowNewProject] = useState(false);

  const openNewProject = () => setShowNewProject(true);
  const closeNewProject = () => setShowNewProject(false);

  return {
    showNewProject,
    openNewProject,
    closeNewProject,
  };
};
