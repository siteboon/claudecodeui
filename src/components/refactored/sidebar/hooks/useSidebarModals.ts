import { useState } from 'react';

/**
 * Hook layer (The Manager)
 * Manages the open/close states of various sidebar modals.
 */
export const useSidebarModals = () => {
  const [showNewProject, setShowNewProject] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [showVersionModal, setShowVersionModal] = useState(false);

  const openNewProject = () => setShowNewProject(true);
  const closeNewProject = () => setShowNewProject(false);
  const openSettingsModal = () => setShowSettingsModal(true);
  const closeSettingsModal = () => setShowSettingsModal(false);
  const openVersionModal = () => setShowVersionModal(true);
  const closeVersionModal = () => setShowVersionModal(false);

  return {
    showNewProject,
    openNewProject,
    closeNewProject,
    showSettingsModal,
    openSettingsModal,
    closeSettingsModal,
    showVersionModal,
    openVersionModal,
    closeVersionModal,
  };
};
