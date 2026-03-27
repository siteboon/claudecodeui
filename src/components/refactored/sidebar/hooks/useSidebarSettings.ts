import { useState } from 'react';

/**
 * Hook layer (The Manager)
 * Manages the layout states for the sidebar, such as collapse/open.
 */
export const useSidebarSettings = () => {
  const [isCollapsed, setIsCollapsed] = useState(false);

  const toggleCollapse = () => setIsCollapsed((prev) => !prev);
  const setCollapsed = (value: boolean) => setIsCollapsed(value);

  return {
    isCollapsed,
    toggleCollapse,
    setCollapsed,
  };
};
