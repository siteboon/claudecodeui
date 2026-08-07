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
 * Minimum prefix length worth redacting in streaming output. Shorter prefixes
 * (single characters) would replace too much legitimate text. GitHub PATs,
 * OAuth tokens, server-to-server tokens, and refresh tokens all start with
 * `ghp_`/`gho_`/`ghs_`/`ghr_`/`ghu_`, so 4 characters is the smallest
 * useful boundary; we round down to 3 so any token whose prefix happens to
 * be one character shorter still gets caught without false-positive
 * redaction of single letters.
 */
const MIN_TOKEN_PREFIX_LENGTH = 3;

/**
 * Cap on the work performed per `redactAnyTokenPrefix` call. A truly
 * malicious token could be megabytes long; without a cap the linear scanner
 * below would spend that many bytes per chunk. GitHub PATs are at most 255
 * characters; the cap is one order of magnitude above that for safety.
 */
const MAX_TOKEN_LENGTH_FOR_REDACTION = 2048;

/**
 * Streaming wrapper around {@link sanitizeGitError} that buffers a token's
 * worth of trailing characters across consecutive chunks. `git`'s `data`
 * events are arbitrary byte slices, not full messages, so a credential can
 * be split across two events: e.g. `https://ghp_abc` in one chunk and
 * `def...@github.com/...` in the next. A naive per-chunk `replace` lets both
 * fragments through.
 *
 * `feed(chunk)` consumes one chunk and returns the redacted portion that is
 * safe to forward. Up to {@link MAX_TOKEN_LENGTH_FOR_REDACTION} characters
 * are retained as a "possible token prefix" until the next chunk (or the
 * close call) confirms they do not form a complete token. Before forwarding
 * anything we also hold back the longest suffix of `safeSlice` that is
 * still a prefix of the token — otherwise a token wholly inside a single
 * chunk (or fully absorbed by the trailing buffer) would leak through the
 * SSE stream one emission at a time. `flush()` returns whatever remains in
 * the buffer after the stream ends; by construction that remainder is
 * shorter than the (capped) token, so it is redacted as a single
 * half-token placeholder.
 *
 * The cap on the effective token length is a defense against a malicious or
 * accidentally-huge token causing unbounded memory use per clone.
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

  // Cap the work by truncating the effective token. We do NOT modify the
  // caller's token, only the prefix we search for and the buffer we keep.
  const effectiveToken = token.length > MAX_TOKEN_LENGTH_FOR_REDACTION
    ? token.slice(0, MAX_TOKEN_LENGTH_FOR_REDACTION)
    : token;
  const maxPrefix = effectiveToken.length - 1;
  let buffer = '';

  // Find the longest suffix of `safeSlice` that is also a non-empty prefix
  // of the token; hold those characters back into the buffer so we never
  // emit text that ends mid-token. Returns the prefix length to retain.
  const trailingPrefixLength = (safeSlice: string): number => {
    const maxLookback = Math.min(maxPrefix, safeSlice.length);
    for (let length = maxLookback; length > 0; length -= 1) {
      if (safeSlice.endsWith(effectiveToken.slice(0, length))) {
        return length;
      }
    }
    return 0;
  };

  // Find the longest suffix of `safeSlice` that is also a non-empty prefix
  // of the token; hold those characters back into the buffer so we never
  // emit text that ends mid-token. Returns the prefix length to retain.
  const trailingPrefixLength = (safeSlice: string): number => {
    const maxLookback = Math.min(maxPrefix, safeSlice.length);
    for (let length = maxLookback; length > 0; length -= 1) {
      if (safeSlice.endsWith(token.slice(0, length))) {
        return length;
      }
    }
    return 0;
  };

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
      let safeSlice = buffer.slice(0, safeEnd);
      buffer = buffer.slice(safeEnd);

      // Never emit text that ends with a non-empty prefix of the token —
      // otherwise the next emission (or the next `flush`) would carry the
      // rest of the credential and a downstream SSE consumer could stitch
      // them back together.
      const retain = trailingPrefixLength(safeSlice);
      if (retain > 0) {
        const retained = safeSlice.slice(safeSlice.length - retain);
        safeSlice = safeSlice.slice(0, safeSlice.length - retain);
        // The retained suffix is at most `maxPrefix` characters long, so
        // it fits in the buffer alongside whatever else we are keeping.
        buffer = retained + buffer;
      }

      // Redact any mid-string prefix of the token that landed inside
      // `safeSlice`. `sanitizeGitError` only catches the full token, so
      // without this pass a credential fragment stranded in the middle of
      // an emission would leak. The trailing-prefix holdback above ensures
      // the emitted string never ends with a credential prefix, so the
      // longest-prefix-first alternation here has a clean boundary.
      return redactAnyTokenPrefix(safeSlice, effectiveToken);
    },
    flush(): string {
      if (!buffer) return '';
      // The remainder is strictly shorter than `effectiveToken.length`. It
      // is therefore a possible credential prefix; replace any prefix of
      // the token present in the remainder with `***` so a downstream
      // consumer cannot reconstruct the credential by concatenating this
      // emission with what `feed` already forwarded.
      const remainder = buffer;
      buffer = '';
      return redactAnyTokenPrefix(remainder, effectiveToken);
    },
  };
}

/**
 * Replace every prefix of `token` (length ≥ {@link MIN_TOKEN_PREFIX_LENGTH})
 * that appears in `message` with `***`. The replacement targets only the
 * specific token's prefixes, so it catches credential fragments that
 * `sanitizeGitError`'s exact-match replacement would miss, while leaving
 * unrelated text alone.
 *
 * Uses a linear scanner rather than a regex of O(N) alternations so the
 * cost is bounded by the cap on the token length and the message size —
 * never quadratic. For each position we try the longest possible match
 * first so a longer prefix wins when shorter prefixes overlap.
 */
function redactAnyTokenPrefix(message: string, token: string): string {
  if (!message || !token) return message;

  // Cap the work by truncating the effective token. We do NOT modify the
  // caller's token, only the prefix we search for.
  const effectiveToken = token.length > MAX_TOKEN_LENGTH_FOR_REDACTION
    ? token.slice(0, MAX_TOKEN_LENGTH_FOR_REDACTION)
    : token;
  if (effectiveToken.length < MIN_TOKEN_PREFIX_LENGTH) return message;

  const firstChar = effectiveToken[0];
  let result = '';
  let cursor = 0;
  while (cursor < message.length) {
    // Fast path: most positions in `message` do not start a token prefix,
    // so check the first character first to avoid entering the inner loop.
    if (message[cursor] !== firstChar) {
      result += message[cursor];
      cursor += 1;
      continue;
    }

    const remaining = message.length - cursor;
    const maxMatch = Math.min(effectiveToken.length, remaining);
    let matchedLength = 0;
    // Try longest prefix first so a longer match wins when shorter
    // prefixes of the token would also match at this position.
    for (let length = maxMatch; length >= MIN_TOKEN_PREFIX_LENGTH; length -= 1) {
      if (message.startsWith(effectiveToken.slice(0, length), cursor)) {
        matchedLength = length;
        break;
      }
    }
    if (matchedLength > 0) {
      result += '***';
      cursor += matchedLength;
    } else {
      result += message[cursor];
      cursor += 1;
    }
  }
  return result;
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
    // `lastError` is what becomes the user-visible failure message, so it
    // must be the redacted form of stderr. Feed the raw chunk through the
    // streaming redactor and accumulate whatever is safe to forward (and
    // safe to display on failure). A split token that crosses this chunk's
    // boundary is still held back by the redactor's buffer.
    lastError += stderrRedactor.feed(raw);
  });

  // Flush any remaining buffered characters when the streams close so a
  // half-token that straddles the end of the stream is also redacted.
  gitProcess.stdout?.on('end', () => {
    forwardTrimmed(stdoutRedactor.flush());
  });
  gitProcess.stderr?.on('end', () => {
    // The flush output is the safe-to-display remainder; append it to
    // `lastError` so the user-visible failure message is built from
    // redacted text only, then forward it as a progress event.
    const flushed = stderrRedactor.flush();
    lastError += flushed;
    forwardTrimmed(flushed);
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
