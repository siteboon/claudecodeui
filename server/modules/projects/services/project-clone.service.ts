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

/**
 * Length of the longest suffix of `text` that is also a proper prefix of
 * `token` — the only part of a chunk a later chunk could still complete into
 * the whole credential.
 *
 * The search is bounded by the token's length, never the stream's, so the cost
 * per chunk stays flat no matter how much output `git` produces.
 */
function trailingTokenPrefixLength(text: string, token: string): number {
  const longestCandidate = Math.min(token.length - 1, text.length);
  for (let length = longestCandidate; length > 0; length -= 1) {
    if (text.endsWith(token.slice(0, length))) {
      return length;
    }
  }

  return 0;
}

/**
 * Redacts a credential from a stream that arrives in arbitrary slices.
 *
 * `git clone --progress` writes every byte of its progress to stderr, and on a
 * failed authentication that stderr carries the clone URL verbatim — token and
 * all — straight into the SSE progress stream. The pipe hands over whatever
 * sized chunks it likes, so the token can straddle two `data` events and a
 * plain per-chunk replace would let both halves through.
 *
 * `push` therefore holds back only the trailing characters that could still
 * grow into the token, and releases everything else immediately, so progress
 * keeps streaming at git's pace instead of arriving in one lump at the end.
 * Over a whole stream the emitted text is the input with every occurrence of
 * the token replaced by `***` — nothing is dropped, so a consumer that
 * concatenates the events cannot reassemble the credential either.
 */
function createTokenRedactor(token: string | null): {
  push: (chunk: string) => string;
  flush: () => string;
} {
  if (!token) {
    return { push: (chunk: string): string => chunk, flush: (): string => '' };
  }

  let heldBack = '';

  return {
    push(chunk: string): string {
      const pending = (heldBack + chunk).split(token).join('***');
      const holdLength = trailingTokenPrefixLength(pending, token);
      if (holdLength === 0) {
        heldBack = '';
        return pending;
      }

      heldBack = pending.slice(pending.length - holdLength);
      return pending.slice(0, pending.length - holdLength);
    },
    /**
     * Closes the stream. Whatever is still held back is, by construction, a
     * proper prefix of the token, so it is reported as a redaction rather than
     * shown: git ends its output with a newline, which holds nothing back, so a
     * non-empty remainder here means the stream really did stop mid-credential.
     */
    flush(): string {
      const hadRemainder = heldBack.length > 0;
      heldBack = '';
      return hadRemainder ? '***' : '';
    },
  };
}

function resolveCloneFailureMessage(lastError: string): string {
  if (lastError.includes('Authentication failed') || lastError.includes('could not read Username')) {
    return 'Authentication failed. Please check your credentials.';
  }

  if (lastError.includes('Repository not found')) {
    return 'Repository not found. Please check the URL and ensure you have access.';
  }

  if (lastError.includes('already exists')) {
    return 'Directory already exists';
  }

  return lastError || 'Git clone failed';
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

  // The clone URL carries the token, so everything git prints is suspect. Both
  // pipes get their own redactor because each buffers its own partial token.
  const stdoutRedactor = createTokenRedactor(githubToken);
  const stderrRedactor = createTokenRedactor(githubToken);

  gitProcess.stdout?.on('data', (data: Buffer | string) => {
    const message = stdoutRedactor.push(data.toString()).trim();
    if (message) {
      handlers.onProgress(message);
    }
  });

  gitProcess.stderr?.on('data', (data: Buffer | string) => {
    const message = stderrRedactor.push(data.toString()).trim();
    if (message) {
      // Only a non-empty piece may replace `lastError`: a chunk can now redact
      // down to nothing, and blanking the last real error would lose the reason
      // the clone failed. The stream carries the failure too, so `lastError` is
      // redacted text and needs no second pass before it is shown.
      lastError = message;
      handlers.onProgress(message);
    }
  });

  // A redactor still holding a partial token when its pipe ends reports the
  // redaction, and only to the progress stream — a credential fragment is never
  // the reason a clone failed.
  gitProcess.stdout?.on('end', () => {
    const message = stdoutRedactor.flush();
    if (message) {
      handlers.onProgress(message);
    }
  });

  gitProcess.stderr?.on('end', () => {
    const message = stderrRedactor.flush();
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

      const errorMessage = resolveCloneFailureMessage(lastError);

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
