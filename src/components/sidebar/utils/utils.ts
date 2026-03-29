import type { TFunction } from 'i18next';
import type { Project } from '../../../types/app';
import type {
  AdditionalSessionsByProject,
  ProjectSortOrder,
  RepoGroup,
  SettingsProject,
  SessionViewModel,
  SessionWithProvider,
} from '../types/types';

export const readProjectSortOrder = (): ProjectSortOrder => {
  try {
    const rawSettings = localStorage.getItem('claude-settings');
    if (!rawSettings) {
      return 'name';
    }

    const settings = JSON.parse(rawSettings) as { projectSortOrder?: ProjectSortOrder };
    return settings.projectSortOrder === 'date' ? 'date' : 'name';
  } catch {
    return 'name';
  }
};

export const loadStarredProjects = (): Set<string> => {
  try {
    const saved = localStorage.getItem('starredProjects');
    return saved ? new Set<string>(JSON.parse(saved)) : new Set<string>();
  } catch {
    return new Set<string>();
  }
};

export const persistStarredProjects = (starredProjects: Set<string>) => {
  try {
    localStorage.setItem('starredProjects', JSON.stringify([...starredProjects]));
  } catch {
    // Keep UI responsive even if storage fails.
  }
};

export const getSessionDate = (session: SessionWithProvider): Date => {
  if (session.__provider === 'cursor') {
    return new Date(session.createdAt || 0);
  }

  if (session.__provider === 'codex') {
    return new Date(session.createdAt || session.lastActivity || 0);
  }

  return new Date(session.lastActivity || session.createdAt || 0);
};

export const getSessionName = (session: SessionWithProvider, t: TFunction): string => {
  if (session.__provider === 'cursor') {
    return session.summary || session.name || t('projects.untitledSession');
  }

  if (session.__provider === 'codex') {
    return session.summary || session.name || t('projects.codexSession');
  }

  if (session.__provider === 'gemini') {
    return session.summary || session.name || t('projects.newSession');
  }

  return session.summary || t('projects.newSession');
};

export const getSessionTime = (session: SessionWithProvider): string => {
  if (session.__provider === 'cursor') {
    return String(session.createdAt || '');
  }

  if (session.__provider === 'codex') {
    return String(session.createdAt || session.lastActivity || '');
  }

  return String(session.lastActivity || session.createdAt || '');
};

export const createSessionViewModel = (
  session: SessionWithProvider,
  currentTime: Date,
  t: TFunction,
): SessionViewModel => {
  const sessionDate = getSessionDate(session);
  const diffInMinutes = Math.floor((currentTime.getTime() - sessionDate.getTime()) / (1000 * 60));

  return {
    isCursorSession: session.__provider === 'cursor',
    isCodexSession: session.__provider === 'codex',
    isGeminiSession: session.__provider === 'gemini',
    isActive: diffInMinutes < 10,
    sessionName: getSessionName(session, t),
    sessionTime: getSessionTime(session),
    messageCount: Number(session.messageCount || 0),
  };
};

export const getAllSessions = (
  project: Project,
  additionalSessions: AdditionalSessionsByProject,
): SessionWithProvider[] => {
  const claudeSessions = [
    ...(project.sessions || []),
    ...(additionalSessions[project.name] || []),
  ].map((session) => ({ ...session, __provider: 'claude' as const }));

  const cursorSessions = (project.cursorSessions || []).map((session) => ({
    ...session,
    __provider: 'cursor' as const,
  }));

  const codexSessions = (project.codexSessions || []).map((session) => ({
    ...session,
    __provider: 'codex' as const,
  }));

  const geminiSessions = (project.geminiSessions || []).map((session) => ({
    ...session,
    __provider: 'gemini' as const,
  }));

  return [...claudeSessions, ...cursorSessions, ...codexSessions, ...geminiSessions].sort(
    (a, b) => getSessionDate(b).getTime() - getSessionDate(a).getTime(),
  );
};

export const getProjectLastActivity = (
  project: Project,
  additionalSessions: AdditionalSessionsByProject,
): Date => {
  const sessions = getAllSessions(project, additionalSessions);
  if (sessions.length === 0) {
    return new Date(0);
  }

  return sessions.reduce((latest, session) => {
    const sessionDate = getSessionDate(session);
    return sessionDate > latest ? sessionDate : latest;
  }, new Date(0));
};

export const sortProjects = (
  projects: Project[],
  projectSortOrder: ProjectSortOrder,
  starredProjects: Set<string>,
  additionalSessions: AdditionalSessionsByProject,
): Project[] => {
  const byName = [...projects];

  byName.sort((projectA, projectB) => {
    const aStarred = starredProjects.has(projectA.name);
    const bStarred = starredProjects.has(projectB.name);

    if (aStarred && !bStarred) {
      return -1;
    }

    if (!aStarred && bStarred) {
      return 1;
    }

    if (projectSortOrder === 'date') {
      return (
        getProjectLastActivity(projectB, additionalSessions).getTime() -
        getProjectLastActivity(projectA, additionalSessions).getTime()
      );
    }

    return (projectA.displayName || projectA.name).localeCompare(projectB.displayName || projectB.name);
  });

  return byName;
};

export const filterProjects = (projects: Project[], searchFilter: string): Project[] => {
  const normalizedSearch = searchFilter.trim().toLowerCase();
  if (!normalizedSearch) {
    return projects;
  }

  return projects.filter((project) => {
    const displayName = (project.displayName || project.name).toLowerCase();
    const projectName = project.name.toLowerCase();
    const branchName = (project.worktreeInfo?.branchName || '').toLowerCase();
    return (
      displayName.includes(normalizedSearch) ||
      projectName.includes(normalizedSearch) ||
      branchName.includes(normalizedSearch)
    );
  });
};

export const getTaskIndicatorStatus = (
  project: Project,
  mcpServerStatus: { hasMCPServer?: boolean; isConfigured?: boolean } | null,
) => {
  const projectConfigured = Boolean(project.taskmaster?.hasTaskmaster);
  const mcpConfigured = Boolean(mcpServerStatus?.hasMCPServer && mcpServerStatus?.isConfigured);

  if (projectConfigured && mcpConfigured) {
    return 'fully-configured';
  }

  if (projectConfigured) {
    return 'taskmaster-only';
  }

  if (mcpConfigured) {
    return 'mcp-only';
  }

  return 'not-configured';
};

/**
 * Group projects that share the same underlying git repository (worktrees).
 *
 * Returns a mixed array of standalone `Project`s (no worktree siblings) and
 * `RepoGroup` objects (multiple worktrees of the same repo).  The position of
 * each group matches the position of its *first* member in the original array
 * so that the existing sort order is preserved.
 */
export const groupProjectsByRepo = (
  projects: Project[],
): (Project | RepoGroup)[] => {
  const groups = new Map<string, Project[]>();
  const insertionOrder: string[] = [];

  for (const project of projects) {
    const repoRoot = project.repoGroup;
    if (!repoRoot) {
      // Standalone project – use its unique name as the key so it stays in order.
      const key = `__standalone__${project.name}`;
      groups.set(key, [project]);
      insertionOrder.push(key);
    } else if (!groups.has(repoRoot)) {
      groups.set(repoRoot, [project]);
      insertionOrder.push(repoRoot);
    } else {
      groups.get(repoRoot)!.push(project);
    }
  }

  return insertionOrder.map((key) => {
    const members = groups.get(key)!;
    if (key.startsWith('__standalone__') || members.length === 1) {
      return members[0];
    }

    // Sort: main worktree first, then by branch name alphabetically.
    const sorted = [...members].sort((a, b) => {
      if (a.isMainWorktree && !b.isMainWorktree) return -1;
      if (!a.isMainWorktree && b.isMainWorktree) return 1;
      return (a.worktreeInfo?.branchName || '').localeCompare(b.worktreeInfo?.branchName || '');
    });

    const main = sorted.find((p) => p.isMainWorktree) || sorted[0];

    return {
      __type: 'repo-group' as const,
      repoRoot: key,
      displayName: main.displayName,
      projects: sorted,
    };
  });
};

export const isRepoGroup = (item: Project | RepoGroup): item is RepoGroup =>
  (item as RepoGroup).__type === 'repo-group';

export const normalizeProjectForSettings = (project: Project): SettingsProject => {
  const fallbackPath =
    typeof project.fullPath === 'string' && project.fullPath.length > 0
      ? project.fullPath
      : typeof project.path === 'string'
        ? project.path
        : '';

  return {
    name: project.name,
    displayName:
      typeof project.displayName === 'string' && project.displayName.trim().length > 0
        ? project.displayName
        : project.name,
    fullPath: fallbackPath,
    path:
      typeof project.path === 'string' && project.path.length > 0
        ? project.path
        : fallbackPath,
  };
};
