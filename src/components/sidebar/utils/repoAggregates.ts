import type { Project } from '../../../types/app';
import type {
  AdditionalSessionsByProject,
  SessionWithProvider,
} from '../types/types';
import { getAllSessions, getSessionDate } from './utils';

const PALETTE_SIZE = 5;

/**
 * Collect every session across the given projects (treated as one repo's
 * worktrees) and sort by recency descending. Each returned session carries
 * `__projectName` so the caller can route clicks to the correct worktree.
 */
export const getRepoSessions = (
  projects: Project[],
  additionalSessions: AdditionalSessionsByProject,
): (SessionWithProvider & { __projectName: string })[] => {
  const all: (SessionWithProvider & { __projectName: string })[] = [];
  for (const project of projects) {
    for (const session of getAllSessions(project, additionalSessions)) {
      all.push({ ...session, __projectName: project.name });
    }
  }
  all.sort((a, b) => getSessionDate(b).getTime() - getSessionDate(a).getTime());
  return all;
};

/**
 * Total session count across a repo, preferring `sessionMeta.total` (which the
 * server may report as larger than the loaded `sessions` array).
 */
export const getRepoSessionTotal = (projects: Project[]): number => {
  let total = 0;
  for (const project of projects) {
    if (typeof project.sessionMeta?.total === 'number') {
      total += project.sessionMeta.total;
      continue;
    }
    total += (project.sessions?.length ?? 0)
      + (project.cursorSessions?.length ?? 0)
      + (project.codexSessions?.length ?? 0)
      + (project.geminiSessions?.length ?? 0);
  }
  return total;
};

/**
 * Deterministic palette index from a branch name. Used to keep "feat/foo"
 * the same color everywhere it appears in the sidebar.
 */
export const branchChipColorIndex = (branchName: string): number => {
  let hash = 0;
  for (let i = 0; i < branchName.length; i += 1) {
    hash = (hash * 31 + branchName.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % PALETTE_SIZE;
};
