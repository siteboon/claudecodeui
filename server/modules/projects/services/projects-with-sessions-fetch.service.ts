import fs from 'node:fs/promises';
import path from 'node:path';

import { projectsDb, sessionsDb } from '@/modules/database/index.js';
import { sessionSynchronizerService } from '@/modules/providers/index.js';
import { WS_OPEN_STATE, connectedClients } from '@/modules/websocket/index.js';
import type { RealtimeClientConnection } from '@/shared/types.js';
import { findAppRoot, getModuleDir } from '@/utils/runtime-paths.js';

type SessionSummary = {
  id: string;
  summary: string;
  messageCount: number;
  lastActivity: string;
};

type SessionsByProvider = Record<'claude' | 'cursor' | 'codex' | 'gemini', SessionSummary[]>;

export type ProjectListItem = {
  projectId: string;
  path: string;
  displayName: string;
  fullPath: string;
  isStarred: boolean;
  sessions: SessionSummary[];
  cursorSessions: SessionSummary[];
  codexSessions: SessionSummary[];
  geminiSessions: SessionSummary[];
  sessionMeta: {
    hasMore: boolean;
    total: number;
  };
};

export type ProjectsSnapshot = {
  generatedAt: string;
  projectCount: number;
  projects: ProjectListItem[];
};

type ProgressUpdate = {
  phase: 'loading' | 'complete';
  current: number;
  total: number;
  currentProject?: string;
};

type GetProjectsWithSessionsOptions = {
  skipSynchronization?: boolean;
};

const __dirname = getModuleDir(import.meta.url);
const APP_ROOT = findAppRoot(__dirname);
const PROJECTS_DUMP_DIR = path.join(APP_ROOT, '.tmp', 'project-dumps');

let projectsSnapshotCounter: number | null = null;

/**
 * Generate better display name from path.
 */
export async function generateDisplayName(projectName: string, actualProjectDir: string | null = null): Promise<string> {
  // Use actual project directory if provided, otherwise decode from project name.
  const projectPath = actualProjectDir || projectName.replace(/-/g, '/');

  // Try to read package.json from the project path.
  try {
    const packageJsonPath = path.join(projectPath, 'package.json');
    const packageData = await fs.readFile(packageJsonPath, 'utf8');
    const packageJson = JSON.parse(packageData) as { name?: string };

    // Return the name from package.json if it exists.
    if (packageJson.name) {
      return packageJson.name;
    }
  } catch {
    // Fall back to path-based naming if package.json doesn't exist or can't be read.
  }

  // If it starts with /, it's an absolute path.
  if (projectPath.startsWith('/')) {
    const parts = projectPath.split('/').filter(Boolean);
    // Return only the last folder name.
    return parts[parts.length - 1] || projectPath;
  }

  return projectPath;
}

/**
 * Group the `sessions` table rows for a project by provider.
 */
function buildSessionsByProviderFromDb(projectPath: string): SessionsByProvider {
  const rows = sessionsDb.getSessionsByProjectPath(projectPath) as Array<{
    provider: string;
    session_id: string;
    custom_name?: string | null;
    updated_at?: string | null;
    created_at?: string | null;
  }>;
  const byProvider: SessionsByProvider = {
    claude: [],
    cursor: [],
    codex: [],
    gemini: [],
  };

  for (const row of rows) {
    const provider = row.provider as keyof SessionsByProvider;
    const bucket = byProvider[provider];
    if (!bucket) {
      continue;
    }

    bucket.push({
      id: row.session_id,
      summary: row.custom_name || '',
      messageCount: 0,
      lastActivity: row.updated_at ?? row.created_at ?? new Date().toISOString(),
    });
  }

  for (const provider of Object.keys(byProvider) as Array<keyof SessionsByProvider>) {
    byProvider[provider].sort((a, b) => new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime());
  }

  return byProvider;
}

async function getNextProjectsSnapshotPath(): Promise<string> {
  await fs.mkdir(PROJECTS_DUMP_DIR, { recursive: true });

  if (projectsSnapshotCounter === null) {
    const entries = await fs.readdir(PROJECTS_DUMP_DIR).catch(() => []);
    projectsSnapshotCounter = entries.reduce((max, entry) => {
      const match = entry.match(/^projects-(\d+)\.json$/);
      if (!match) {
        return max;
      }

      return Math.max(max, Number(match[1]));
    }, 0);
  }

  projectsSnapshotCounter += 1;
  const suffix = String(projectsSnapshotCounter).padStart(4, '0');
  return path.join(PROJECTS_DUMP_DIR, `projects-${suffix}.json`);
}

/**
 * Builds a typed snapshot payload for project dumps.
 */
export function createProjectsSnapshot(projects: ProjectListItem[]): ProjectsSnapshot {
  return {
    generatedAt: new Date().toISOString(),
    projectCount: projects.length,
    projects,
  };
}

/**
 * Writes a projects snapshot file as an incrementing artifact.
 */
export async function writeSnapshot(projects: ProjectListItem[]): Promise<void> {
  try {
    const snapshot = createProjectsSnapshot(projects);
    const snapshotJson = JSON.stringify(snapshot, (_, value) => (typeof value === 'bigint' ? value.toString() : value), 2);

    while (true) {
      const snapshotPath = await getNextProjectsSnapshotPath();
      try {
        await fs.writeFile(snapshotPath, snapshotJson, { encoding: 'utf8', flag: 'wx' });
        break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
          continue;
        }
        throw error;
      }
    }
  } catch (error) {
    console.warn('Could not write projects snapshot:', (error as Error).message);
  }
}

// Broadcast progress to all connected WebSocket clients
function broadcastProgress(progress: ProgressUpdate) {
  const message = JSON.stringify({
    type: 'loading_progress',
    ...progress,
  });

  connectedClients.forEach((client: RealtimeClientConnection) => {
    if (client.readyState === WS_OPEN_STATE) {
      client.send(message);
    }
  });
}

/**
 * Reads all projects from DB and returns provider-bucketed session summaries.
 */
export async function getProjectsWithSessions(
  options: GetProjectsWithSessionsOptions = {}
): Promise<ProjectListItem[]> {
  if (!options.skipSynchronization) {
    await sessionSynchronizerService.synchronizeSessions();
  }

  const projectRows = projectsDb.getProjectPaths() as Array<{
    project_id: string;
    project_path: string;
    custom_project_name?: string | null;
    isStarred?: number;
  }>;
  const totalProjects = projectRows.length;
  const projects: ProjectListItem[] = [];
  let processedProjects = 0;

  for (const row of projectRows) {
    processedProjects += 1;

    const projectId = row.project_id;
    const projectPath = row.project_path;

    broadcastProgress({
      phase: 'loading',
      current: processedProjects,
      total: totalProjects,
      currentProject: projectPath,
    });

    const displayName =
      row.custom_project_name && row.custom_project_name.trim().length > 0
        ? row.custom_project_name
        : await generateDisplayName(path.basename(projectPath) || projectPath, projectPath);

    const sessionsByProvider = buildSessionsByProviderFromDb(projectPath);
    const claudeSessionsAll = sessionsByProvider.claude;
    const claudeSessions = claudeSessionsAll.slice(0, 5);

    projects.push({
      projectId,
      path: projectPath,
      displayName,
      fullPath: projectPath,
      isStarred: Boolean(row.isStarred),
      sessions: claudeSessions,
      cursorSessions: sessionsByProvider.cursor,
      codexSessions: sessionsByProvider.codex,
      geminiSessions: sessionsByProvider.gemini,
      sessionMeta: {
        hasMore: false,
        total: claudeSessionsAll.length,
      },
    });
  }

  broadcastProgress({
    phase: 'complete',
    current: totalProjects,
    total: totalProjects,
  });

  await writeSnapshot(projects);
  return projects;
}
