import { access, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';

// cross-spawn: drop-in spawn with Windows .cmd/PATHEXT resolution.
import spawn from 'cross-spawn';

import { githubTokensDb } from '@/modules/database/index.js';
import { createProject } from '@/modules/projects/services/project-management.service.js';
import type { WorkspacePathValidationResult } from '@/shared/types.js';
import { AppError, validateWorkspacePath } from '@/shared/utils.js';

type CloneProjectInput = {
  workspacePath: string;
  githubUrl: string;
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
  getGithubTokenById: (
    tokenId: number,
    userId: number,
  ) => Promise<{ github_token: string } | null>;
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

/**
 * Streaming wrapper around {@link sanitizeGitError} that buffers a token's
 * worth of trailing characters across consecutive chunks. `git`'s `data`
 * events are arbitrary byte slices, not full messages, so a credential can
 * be split across two events: e.g. `https://ghp_abc` in one chunk and
 * `def...@github.com/...` in the next. A naive per-chunk `replace` lets both
 * fragments through.
 *
 * `feed(chunk)` consumes one chunk and returns the redacted portion that is
 * safe to forward. Up to `token.length - 1` characters are retained as a
 * "possible token prefix" until the next chunk (or the close call)
 * confirms they do not form a complete token. `flush()` returns whatever
 * remains in the buffer after the stream ends — redacted like any other
 * output, with any unmatched prefix replaced by `***` so a half-token at
 * EOF still does not leak.
 */
function createStreamingRedactor(token: string | null) {
  if (!token) {
    return {
      feed(chunk: string): string {
        return chunk;
      },
      flush(): string {
        return '';
      },
    };
  }

  const maxPrefix = token.length - 1;
  let buffer = '';

  return {
    feed(chunk: string): string {
      if (!chunk) return '';

      buffer += chunk;
      if (buffer.length <= maxPrefix) {
        // Not enough characters yet for even a full token to exist; hold
        // the whole buffer until the next chunk (or close) and emit nothing.
        return '';
      }

      const safeEnd = buffer.length - maxPrefix;
      const safeSlice = buffer.slice(0, safeEnd);
      buffer = buffer.slice(safeEnd);
      return sanitizeGitError(safeSlice, token);
    },
    flush(): string {
      if (!buffer) return '';
      // Any remaining buffer at EOF is a half-token at worst; redact it
      // wholesale so no credential fragment survives the stream close.
      const remainder = buffer;
      buffer = '';
      return sanitizeGitError(remainder, token);
    },
  };
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
  getGithubTokenById: async (
    tokenId: number,
    userId: number,
  ): Promise<{ github_token: string } | null> => {
    const tokenRow = githubTokensDb.getGithubTokenById(userId, tokenId) as
      | { github_token: string }
      | null;
    return tokenRow;
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

  let githubToken: string | null = null;
  if (typeof input.githubTokenId === 'number') {
    const numericUserId =
      typeof input.userId === 'number' ? input.userId : Number.parseInt(String(input.userId), 10);
    if (Number.isNaN(numericUserId)) {
      throw new AppError('Authenticated user is required', {
        code: 'AUTHENTICATION_REQUIRED',
        statusCode: 401,
      });
    }

    const token = await dependencies.getGithubTokenById(input.githubTokenId, numericUserId);
    if (!token) {
      throw new AppError('GitHub token not found', {
        code: 'GITHUB_TOKEN_NOT_FOUND',
        statusCode: 404,
      });
    }

    githubToken = token.github_token;
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
  if (githubToken) {
    try {
      const url = new URL(normalizedGithubUrl);
      url.username = githubToken;
      url.password = '';
      cloneUrl = url.toString();
    } catch {
      // SSH URLs cannot be represented by URL constructor and are used as-is.
    }
  }

  handlers.onProgress(`Cloning into '${repoName}'...`);
  const gitProcess = dependencies.spawnGitClone(cloneUrl, clonePath);
  let lastError = '';

  // Buffer up to `token.length - 1` characters across chunks so a credential
  // that is split across two `data` events is still redacted before it
  // reaches the SSE stream. See {@link createStreamingRedactor}.
  const stdoutRedactor = createStreamingRedactor(githubToken);
  const stderrRedactor = createStreamingRedactor(githubToken);

  const forwardTrimmed = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    handlers.onProgress(trimmed);
  };

  gitProcess.stdout?.on('data', (data: Buffer | string) => {
    forwardTrimmed(stdoutRedactor.feed(data.toString()));
  });

  gitProcess.stderr?.on('data', (data: Buffer | string) => {
    const raw = data.toString();
    lastError = raw;
    forwardTrimmed(stderrRedactor.feed(raw));
  });

  // Flush any remaining buffered characters when the streams close so a
  // half-token that straddles the end of the stream is also redacted.
  gitProcess.stdout?.on('end', () => {
    forwardTrimmed(stdoutRedactor.flush());
  });
  gitProcess.stderr?.on('end', () => {
    forwardTrimmed(stderrRedactor.flush());
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
