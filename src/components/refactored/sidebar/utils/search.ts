import type { Project } from '@/types/app';

/**
 * Filters workspaces/projects by matching the search string against
 * both `displayName` and `name` (case-insensitive substring match).
 */
export const filterWorkspacesByName = (workspaces: Project[], filter: string): Project[] => {
  const normalized = filter.trim().toLowerCase();
  if (!normalized) return workspaces;

  return workspaces.filter((project) => {
    const displayName = (project.displayName || project.name).toLowerCase();
    const projectName = project.name.toLowerCase();
    return displayName.includes(normalized) || projectName.includes(normalized);
  });
};
