import { access, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

import { projectsDb } from '@/modules/database/index.js';
import { AppError } from '@/shared/utils.js';

type TaskMasterTask = {
  status?: string;
  subtasks?: Array<{
    status?: string;
  }>;
};

type TaskMasterMetadata =
  | {
      taskCount: number;
      subtaskCount: number;
      completed: number;
      pending: number;
      inProgress: number;
      review: number;
      completionPercentage: number;
      lastModified: string;
    }
  | {
      error: string;
    }
  | null;

type TaskMasterDetectionResult = {
  hasTaskmaster: boolean;
  hasEssentialFiles?: boolean;
  files?: Record<string, boolean>;
  metadata?: TaskMasterMetadata;
  path?: string;
  reason?: string;
};

type NormalizedTaskMasterInfo = {
  hasTaskmaster: boolean;
  hasEssentialFiles: boolean;
  metadata: TaskMasterMetadata;
  status: 'configured' | 'not-configured';
};

type GetProjectTaskMasterByIdResult = {
  projectId: string;
  projectPath: string;
  taskmaster: NormalizedTaskMasterInfo;
};

type GetProjectTaskMasterDependencies = {
  resolveProjectPathById: (projectId: string) => string | null;
  detectTaskMasterFolder: (projectPath: string) => Promise<TaskMasterDetectionResult>;
};

type GetProjectTaskMasterResolver = (projectId: string) => Promise<GetProjectTaskMasterByIdResult | null>;

function extractTasksFromJson(tasksData: unknown): TaskMasterTask[] {
  if (!tasksData || typeof tasksData !== 'object') {
    return [];
  }

  const legacyTasks = (tasksData as { tasks?: unknown }).tasks;
  if (Array.isArray(legacyTasks)) {
    return legacyTasks as TaskMasterTask[];
  }

  const taggedTaskCollections: TaskMasterTask[] = [];
  for (const tagValue of Object.values(tasksData)) {
    if (!tagValue || typeof tagValue !== 'object') {
      continue;
    }

    const tagTasks = (tagValue as { tasks?: unknown }).tasks;
    if (Array.isArray(tagTasks)) {
      taggedTaskCollections.push(...(tagTasks as TaskMasterTask[]));
    }
  }

  return taggedTaskCollections;
}

async function detectTaskMasterFolder(projectPath: string): Promise<TaskMasterDetectionResult> {
  try {
    const taskMasterPath = path.join(projectPath, '.taskmaster');

    try {
      const taskMasterStats = await stat(taskMasterPath);
      if (!taskMasterStats.isDirectory()) {
        return {
          hasTaskmaster: false,
          reason: '.taskmaster exists but is not a directory',
        };
      }
    } catch (error) {
      const fileError = error as NodeJS.ErrnoException;
      if (fileError.code === 'ENOENT') {
        return {
          hasTaskmaster: false,
          reason: '.taskmaster directory not found',
        };
      }

      throw fileError;
    }

    const keyFiles = ['tasks/tasks.json', 'config.json'];
    const fileStatus: Record<string, boolean> = {};
    let hasEssentialFiles = true;

    for (const fileName of keyFiles) {
      const absoluteFilePath = path.join(taskMasterPath, fileName);
      try {
        await access(absoluteFilePath);
        fileStatus[fileName] = true;
      } catch {
        fileStatus[fileName] = false;
        if (fileName === 'tasks/tasks.json') {
          hasEssentialFiles = false;
        }
      }
    }

    let taskMetadata: TaskMasterMetadata = null;
    if (fileStatus['tasks/tasks.json']) {
      const tasksPath = path.join(taskMasterPath, 'tasks/tasks.json');
      try {
        const tasksContent = await readFile(tasksPath, 'utf8');
        const parsedTasksJson = JSON.parse(tasksContent) as unknown;
        const tasks = extractTasksFromJson(parsedTasksJson);

        const stats = tasks.reduce(
          (accumulator, currentTask) => {
            accumulator.total += 1;
            const normalizedTaskStatus = currentTask.status || 'pending';
            accumulator.byStatus[normalizedTaskStatus] = (accumulator.byStatus[normalizedTaskStatus] || 0) + 1;

            if (Array.isArray(currentTask.subtasks)) {
              for (const subtask of currentTask.subtasks) {
                accumulator.subtotalTasks += 1;
                const normalizedSubtaskStatus = subtask.status || 'pending';
                accumulator.subtaskByStatus[normalizedSubtaskStatus] =
                  (accumulator.subtaskByStatus[normalizedSubtaskStatus] || 0) + 1;
              }
            }

            return accumulator;
          },
          {
            total: 0,
            subtotalTasks: 0,
            byStatus: {} as Record<string, number>,
            subtaskByStatus: {} as Record<string, number>,
          },
        );

        const tasksStat = await stat(tasksPath);
        taskMetadata = {
          taskCount: stats.total,
          subtaskCount: stats.subtotalTasks,
          completed: stats.byStatus.done || 0,
          pending: stats.byStatus.pending || 0,
          inProgress: stats.byStatus['in-progress'] || 0,
          review: stats.byStatus.review || 0,
          completionPercentage: stats.total > 0 ? Math.round(((stats.byStatus.done || 0) / stats.total) * 100) : 0,
          lastModified: tasksStat.mtime.toISOString(),
        };
      } catch (parseError) {
        console.warn('Failed to parse tasks.json:', (parseError as Error).message);
        taskMetadata = {
          error: 'Failed to parse tasks.json',
        };
      }
    }

    return {
      hasTaskmaster: true,
      hasEssentialFiles,
      files: fileStatus,
      metadata: taskMetadata,
      path: taskMasterPath,
    };
  } catch (error) {
    console.error('Error detecting TaskMaster folder:', error);
    return {
      hasTaskmaster: false,
      reason: `Error checking directory: ${(error as Error).message}`,
    };
  }
}

function normalizeTaskMasterInfo(taskMasterResult: TaskMasterDetectionResult | null = null): NormalizedTaskMasterInfo {
  const hasTaskmaster = Boolean(taskMasterResult?.hasTaskmaster);
  const hasEssentialFiles = Boolean(taskMasterResult?.hasEssentialFiles);

  return {
    hasTaskmaster,
    hasEssentialFiles,
    metadata: taskMasterResult?.metadata ?? null,
    status: hasTaskmaster && hasEssentialFiles ? 'configured' : 'not-configured',
  };
}

const defaultDependencies: GetProjectTaskMasterDependencies = {
  resolveProjectPathById: (projectId: string): string | null => projectsDb.getProjectPathById(projectId),
  detectTaskMasterFolder,
};

export async function getProjectTaskMasterById(
  projectId: string,
  dependencies: GetProjectTaskMasterDependencies = defaultDependencies,
): Promise<GetProjectTaskMasterByIdResult | null> {
  const projectPath = dependencies.resolveProjectPathById(projectId);
  if (!projectPath) {
    return null;
  }

  const taskMasterResult = await dependencies.detectTaskMasterFolder(projectPath);
  return {
    projectId,
    projectPath,
    taskmaster: normalizeTaskMasterInfo(taskMasterResult),
  };
}

export async function getProjectTaskMaster(
  projectId: string,
  resolveById: GetProjectTaskMasterResolver = getProjectTaskMasterById,
): Promise<GetProjectTaskMasterByIdResult> {
  const normalizedProjectId = projectId.trim();
  if (!normalizedProjectId) {
    throw new AppError('projectId is required', {
      code: 'PROJECT_ID_REQUIRED',
      statusCode: 400,
    });
  }

  const taskMasterDetails = await resolveById(normalizedProjectId);
  if (!taskMasterDetails) {
    throw new AppError('Project not found', {
      code: 'PROJECT_NOT_FOUND',
      statusCode: 404,
    });
  }

  return taskMasterDetails;
}
