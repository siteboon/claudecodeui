import type { Project } from '@/shared/types';

export type ProjectWorktreeGroup = {
  project: Project;
  /** Projects that are linked git worktrees of `project`, in list order. */
  worktrees: Project[];
};

const normalize = (value: string) => value.replace(/[\\/]+$/, '');

/**
 * Nests worktree projects under the project of their main repository, keeping the
 * incoming order of top-level rows. A worktree whose repository is not in the list
 * (filtered out by search, archived, or never opened) stays a top-level row.
 */
export function groupWorktreeProjects(projects: Project[]): ProjectWorktreeGroup[] {
  const byPath = new Map<string, Project>();
  for (const project of projects) {
    byPath.set(normalize(project.fullPath || project.path || ''), project);
  }

  const parentOf = new Map<string, Project>();
  for (const project of projects) {
    const parentPath = typeof project.worktreeOf === 'string' && project.worktreeOf ? normalize(project.worktreeOf) : null;
    const parent = parentPath ? byPath.get(parentPath) : undefined;
    // Only one level: a parent that is itself nested keeps its worktrees flat under its own row.
    if (parent && parent !== project && !(typeof parent.worktreeOf === 'string' && byPath.has(normalize(parent.worktreeOf)))) {
      parentOf.set(project.projectId, parent);
    }
  }

  const groups = new Map<string, ProjectWorktreeGroup>();
  const ordered: ProjectWorktreeGroup[] = [];
  for (const project of projects) {
    if (parentOf.has(project.projectId)) continue;
    const group = { project, worktrees: [] as Project[] };
    groups.set(project.projectId, group);
    ordered.push(group);
  }
  for (const project of projects) {
    const parent = parentOf.get(project.projectId);
    if (parent) groups.get(parent.projectId)?.worktrees.push(project);
  }
  return ordered;
}
