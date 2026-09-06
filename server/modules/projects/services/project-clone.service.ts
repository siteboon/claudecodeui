import { access, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';

// cross-spawn: drop-in spawn with Windows .cmd/PATHEXT resolution.
import spawn from 'cross-spawn';

import { credentialsDb } from '@/modules/database/index.js';
import { createProject } from '@/modules/projects/services/project-management.service.js';
import type { WorkspacePathValidationResult } from '@/shared/types.js';
import {
  AppError,
  CREDENTIAL_TYPE_BY_PROVIDER,
  getNonGithubBasicAuthCredentials,
  validateUrlMatchesProvider,
  validateWorkspacePath,
  type GitProvider,
} from '@/shared/utils.js';

const SCP_LIKE_SSH_PATTERN = /^(?:ssh:\/\/)?git@([^:/]+)[:/]/;

/** Extracts the host from an SCP-style SSH URL (`git@host:owner/repo.git`), which `new URL()` rejects outright. */
function extractScpLikeSshHost(url: string): string | null {
  const match = SCP_LIKE_SSH_PATTERN.exec(url.trim());
  return match ? match[1] : null;
}

type CloneProjectInput = {
  workspacePath: string;
  githubUrl: string;
  gitProvider?: GitProvider;
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
  getCredentialById: (
    credentialId: number,
    userId: number,
    credentialType: string,
  ) => Promise<{ credential_value: string } | null>;
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
  getCredentialById: async (
    credentialId: number,
    userId: number,
    credentialType: string,
  ): Promise<{ credential_value: string } | null> => {
    return credentialsDb.getCredentialById(userId, credentialId, credentialType);
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
  const normalizedGithubUrl = input.githubUrl.trim();

  if (!normalizedWorkspacePath) {
    throw new AppError('workspacePath and githubUrl are required', {
      code: 'WORKSPACE_PATH_REQUIRED',
      statusCode: 400,
    });
  }

  if (!normalizedGithubUrl) {
    throw new AppError('workspacePath and githubUrl are required', {
      code: 'GITHUB_URL_REQUIRED',
      statusCode: 400,
    });
  }

  if (normalizedGithubUrl.startsWith('-')) {
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

  const gitProvider: GitProvider = input.gitProvider || 'github';
  const credentialType = gitProvider === 'custom' ? null : CREDENTIAL_TYPE_BY_PROVIDER[gitProvider];

  let githubToken: string | null = null;
  if (typeof input.githubTokenId === 'number') {
    if (!credentialType) {
      throw new AppError('Stored credentials are not supported for Custom Git; paste a token for this clone instead.', {
        code: 'CUSTOM_PROVIDER_NO_STORED_CREDENTIAL',
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

    const credential = await dependencies.getCredentialById(input.githubTokenId, numericUserId, credentialType);
    if (!credential) {
      throw new AppError('Credential not found', {
        code: 'GITHUB_TOKEN_NOT_FOUND',
        statusCode: 404,
      });
    }

    githubToken = credential.credential_value;
  } else if (input.newGithubToken && input.newGithubToken.trim().length > 0) {
    githubToken = input.newGithubToken.trim();
  }

  const sanitizedGithubUrl = normalizedGithubUrl.replace(/\/+$/, '').replace(/\.git$/, '');
  const repoName = sanitizedGithubUrl.split('/').pop() || 'repository';
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

  let cloneUrl = normalizedGithubUrl;
  try {
    const url = new URL(normalizedGithubUrl);
    if (url.protocol !== 'https:') {
      throw new AppError('Repository URL must use HTTPS', {
        code: 'INVALID_GITHUB_URL',
        statusCode: 400,
      });
    }
    validateUrlMatchesProvider(gitProvider, url.hostname);

    if (githubToken) {
      const providerCreds = getNonGithubBasicAuthCredentials(gitProvider, githubToken);
      if (providerCreds) {
        url.username = providerCreds.username;
        url.password = providerCreds.password;
      } else {
        url.username = githubToken;
        url.password = '';
      }
      cloneUrl = url.toString();
    }
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }

    // new URL() rejects SCP-style SSH syntax (git@host:owner/repo.git) outright;
    // validate the host it names directly instead of skipping validation.
    const sshHost = extractScpLikeSshHost(normalizedGithubUrl);
    if (!sshHost) {
      throw new AppError('Invalid githubUrl', {
        code: 'INVALID_GITHUB_URL',
        statusCode: 400,
      });
    }
    validateUrlMatchesProvider(gitProvider, sshHost);
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

      const sanitizedError = sanitizeGitError(lastError, githubToken);
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
