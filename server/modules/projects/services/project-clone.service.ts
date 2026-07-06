import { spawn } from 'node:child_process';
import { access, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';

import { credentialsDb } from '@/modules/database/index.js';
import { createProject } from '@/modules/projects/services/project-management.service.js';
import type { WorkspacePathValidationResult } from '@/shared/types.js';
import { AppError, validateWorkspacePath } from '@/shared/utils.js';

type CloneProjectInput = {
  workspacePath: string;
  repositoryUrl?: string;
  credentialType?: string | null;
  credentialId?: number | null;
  newCredentialToken?: string | null;
  githubUrl?: string;
  githubTokenId?: number | null;
  newGithubToken?: string | null;
  userId: number | string;
};

type CloneCompletePayload = {
  project: Record<string, unknown>;
  message: string;
};

type CloneProjectEventHandlers = {
  onProgress: (message: string) => void;
  onComplete: (payload: CloneCompletePayload) => void;
};

type GitCloneProcess = {
  stdout: NodeJS.ReadableStream | null;
  stderr: NodeJS.ReadableStream | null;
  on(event: 'close', listener: (code: number | null) => void): void;
  on(event: 'error', listener: (error: NodeJS.ErrnoException) => void): void;
  kill(): void;
};

type CloneProjectDependencies = {
  validatePath: (requestedPath: string) => Promise<WorkspacePathValidationResult>;
  ensureDirectory: (directoryPath: string) => Promise<void>;
  pathExists: (targetPath: string) => Promise<boolean>;
  removePath: (targetPath: string) => Promise<void>;
  getCredentialValueById: (
    userId: number,
    tokenId: number,
    credentialType: string,
  ) => Promise<string | null>;
  spawnGitClone: (cloneUrl: string, clonePath: string) => GitCloneProcess;
  registerProject: (projectPath: string, customName: string) => Promise<{ project: Record<string, unknown> }>;
  logError: (message: string, error: unknown) => void;
};

export type CloneProjectOperation = {
  waitForCompletion: Promise<void>;
  cancel: () => void;
};

async function defaultPathExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return false;
    }

    throw error;
  }
}

function sanitizeGitError(message: string, token: string | null): string {
  if (!message || !token) {
    return message;
  }

  const escapedToken = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return message.replace(new RegExp(escapedToken, 'g'), '***');
}

function resolveCloneFailureMessage(lastError: string, sanitizedError: string): string {
  if (lastError.includes('Authentication failed') || lastError.includes('could not read Username')) {
    return 'Authentication failed. Please check your credentials.';
  }

  if (lastError.includes('Repository not found')) {
    return 'Repository not found. Please check the URL and ensure you have access.';
  }

  if (lastError.includes('already exists')) {
    return 'Directory already exists';
  }

  if (sanitizedError) {
    return sanitizedError;
  }

  return 'Git clone failed';
}

function resolveErrorMessage(error: unknown): string {
  if (error instanceof AppError) {
    return error.message;
  }

  if (error instanceof Error && error.message) {
    return error.message;
  }

  return 'Unexpected error';
}

const defaultDependencies: CloneProjectDependencies = {
  validatePath: validateWorkspacePath,
  ensureDirectory: async (directoryPath: string): Promise<void> => {
    await mkdir(directoryPath, { recursive: true });
  },
  pathExists: defaultPathExists,
  removePath: async (targetPath: string): Promise<void> => {
    await rm(targetPath, { recursive: true, force: true });
  },
  getCredentialValueById: async (
    userId: number,
    credentialId: number,
    credentialType: string,
  ): Promise<string | null> => {
    return credentialsDb.getCredentialValueById(userId, credentialId, credentialType);
  },
  spawnGitClone: (cloneUrl: string, clonePath: string): GitCloneProcess =>
    spawn('git', ['clone', '--progress', '--', cloneUrl, clonePath], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: '0',
      },
    }) as unknown as GitCloneProcess,
  registerProject: async (
    projectPath: string,
    customName: string,
  ): Promise<{ project: Record<string, unknown> }> =>
    createProject({
      projectPath,
      customName,
    }) as Promise<{ project: Record<string, unknown> }>,
  logError: (message: string, error: unknown): void => {
    console.error(message, error);
  },
};

export async function startCloneProject(
  input: CloneProjectInput,
  handlers: CloneProjectEventHandlers,
  dependencies: CloneProjectDependencies = defaultDependencies,
): Promise<CloneProjectOperation> {
  const normalizedWorkspacePath = input.workspacePath.trim();
  const normalizedRepositoryUrl = (input.repositoryUrl ?? input.githubUrl ?? '').trim();

  if (!normalizedWorkspacePath) {
    throw new AppError('workspacePath and githubUrl are required', {
      code: 'WORKSPACE_PATH_REQUIRED',
      statusCode: 400,
    });
  }

  if (!normalizedRepositoryUrl) {
    throw new AppError('workspacePath and githubUrl are required', {
      code: 'GITHUB_URL_REQUIRED',
      statusCode: 400,
    });
  }

  if (normalizedRepositoryUrl.startsWith('-')) {
    throw new AppError('Invalid githubUrl', {
      code: 'INVALID_GITHUB_URL',
      statusCode: 400,
    });
  }

  const pathValidation = await dependencies.validatePath(normalizedWorkspacePath);
  if (!pathValidation.valid || !pathValidation.resolvedPath) {
    throw new AppError(pathValidation.error || 'Invalid workspace path', {
      code: 'INVALID_PROJECT_PATH',
      statusCode: 400,
    });
  }

  const absolutePath = pathValidation.resolvedPath;
  await dependencies.ensureDirectory(absolutePath);

  let credentialToken: string | null = null;
  const credentialId = typeof input.credentialId === 'number' ? input.credentialId : input.githubTokenId;
  const credentialType = input.credentialType || (typeof input.githubTokenId === 'number' ? 'github_token' : null);
  const newCredentialToken = input.newCredentialToken ?? input.newGithubToken;

  if (typeof credentialId === 'number') {
    if (credentialType !== 'github_token' && credentialType !== 'gitlab_token') {
      throw new AppError('Invalid credential type', {
        code: 'INVALID_CREDENTIAL_TYPE',
        statusCode: 400,
      });
    }

    const numericUserId =
      typeof input.userId === 'number' ? input.userId : Number.parseInt(String(input.userId), 10);
    if (Number.isNaN(numericUserId)) {
      throw new AppError('Authenticated user is required', {
        code: 'AUTHENTICATION_REQUIRED',
        statusCode: 401,
      });
    }

    const token = await dependencies.getCredentialValueById(numericUserId, credentialId, credentialType);
    if (!token) {
      throw new AppError('Credential not found', {
        code: credentialType === 'github_token' ? 'GITHUB_TOKEN_NOT_FOUND' : 'CREDENTIAL_NOT_FOUND',
        statusCode: 404,
      });
    }

    credentialToken = token;
  } else if (newCredentialToken && newCredentialToken.trim().length > 0) {
    credentialToken = newCredentialToken.trim();
  }

  const sanitizedRepositoryUrl = normalizedRepositoryUrl.replace(/\/+$/, '').replace(/\.git$/, '');
  const repoName = sanitizedRepositoryUrl.split('/').pop() || 'repository';
  const clonePath = path.join(absolutePath, repoName);

  if (await dependencies.pathExists(clonePath)) {
    throw new AppError(
      `Directory "${repoName}" already exists. Please choose a different location or remove the existing directory.`,
      {
        code: 'CLONE_TARGET_ALREADY_EXISTS',
        statusCode: 409,
      },
    );
  }

  let cloneUrl = normalizedRepositoryUrl;
  if (credentialToken) {
    try {
      const url = new URL(normalizedRepositoryUrl);
      url.username = credentialToken;
      url.password = '';
      cloneUrl = url.toString();
    } catch {
      // SSH URLs cannot be represented by URL constructor and are used as-is.
    }
  }

  handlers.onProgress(`Cloning into '${repoName}'...`);
  const gitProcess = dependencies.spawnGitClone(cloneUrl, clonePath);
  let lastError = '';

  gitProcess.stdout?.on('data', (data: Buffer | string) => {
    const message = data.toString().trim();
    if (message) {
      handlers.onProgress(message);
    }
  });

  gitProcess.stderr?.on('data', (data: Buffer | string) => {
    const message = data.toString().trim();
    lastError = message;
    if (message) {
      handlers.onProgress(message);
    }
  });

  const waitForCompletion = new Promise<void>((resolve, reject) => {
    gitProcess.on('close', async (code) => {
      if (code === 0) {
        try {
          const createdProject = await dependencies.registerProject(clonePath, repoName);
          handlers.onComplete({
            project: createdProject.project,
            message: 'Repository cloned successfully',
          });
          resolve();
        } catch (error) {
          reject(
            new AppError(`Clone succeeded but failed to add project: ${resolveErrorMessage(error)}`, {
              code: 'CLONE_PROJECT_REGISTRATION_FAILED',
              statusCode: 500,
            }),
          );
        }
        return;
      }

      const sanitizedError = sanitizeGitError(lastError, credentialToken);
      const errorMessage = resolveCloneFailureMessage(lastError, sanitizedError);

      try {
        await dependencies.removePath(clonePath);
      } catch (cleanupError) {
        dependencies.logError('Failed to clean up after clone failure:', cleanupError);
      }

      reject(
        new AppError(errorMessage, {
          code: 'GIT_CLONE_FAILED',
          statusCode: 500,
        }),
      );
    });

    gitProcess.on('error', (error) => {
      if (error.code === 'ENOENT') {
        reject(
          new AppError('Git is not installed or not in PATH', {
            code: 'GIT_NOT_FOUND',
            statusCode: 500,
          }),
        );
        return;
      }

      reject(
        new AppError(error.message, {
          code: 'GIT_EXECUTION_FAILED',
          statusCode: 500,
        }),
      );
    });
  });

  return {
    waitForCompletion,
    cancel: () => {
      gitProcess.kill();
    },
  };
}
