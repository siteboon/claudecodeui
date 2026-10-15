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
  spawnGitClone: (
    cloneUrl: string,
    clonePath: string,
    environment: NodeJS.ProcessEnv,
  ) => GitCloneProcess;
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
 * The only origin the credential helper answers for. The token is a GitHub
 * token; a helper that answered every challenge would hand it to whatever
 * host the clone URL names — and over plain http, in the clear.
 */
const GITHUB_TOKEN_CREDENTIAL_SCOPE = 'credential.https://github.com.helper';

/**
 * Builds the environment the clone runs in. The token never goes into the
 * clone URL: git echoes that URL on stderr (which is the SSE progress stream),
 * it sits in the process argv (readable through /proc) and it is written to the
 * cloned repo's `.git/config` as the remote. Instead env-only config points git
 * at a credential helper that reads the token from its own environment, so no
 * channel git exposes carries it. The empty first helper entry clears any
 * helper configured on the machine so a credential stored there cannot shadow
 * the one the user selected; the helper itself is scoped to github.com over
 * https, so a clone from any other host gets no credential at all.
 */
function buildGitCloneEnvironment(githubToken: string | null): NodeJS.ProcessEnv {
  if (!githubToken) {
    return { ...process.env, GIT_TERMINAL_PROMPT: '0' };
  }

  return {
    ...process.env,
    GIT_CONFIG_COUNT: '2',
    GIT_CONFIG_KEY_0: 'credential.helper',
    GIT_CONFIG_VALUE_0: '',
    GIT_CONFIG_KEY_1: GITHUB_TOKEN_CREDENTIAL_SCOPE,
    GIT_CONFIG_VALUE_1: '!f() { echo username=x-access-token; echo "password=$CLOUDCLI_GITHUB_TOKEN"; }; f',
    CLOUDCLI_GITHUB_TOKEN: githubToken,
    GIT_TERMINAL_PROMPT: '0',
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
  spawnGitClone: (
    cloneUrl: string,
    clonePath: string,
    environment: NodeJS.ProcessEnv,
  ): GitCloneProcess =>
    spawn('git', ['clone', '--progress', '--', cloneUrl, clonePath], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: environment,
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

/**
 * Whether a clone URL embeds a credential: any password, or a username on an
 * http(s) URL. An SSH URL's `git@` is a login name, not a secret.
 */
function carriesCredentials(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    // scp-like `git@github.com:org/repo.git` and bare paths are not URLs;
    // an scp-like user is an SSH login, which is not a credential.
    return false;
  }
  if (parsed.password) {
    return true;
  }
  return Boolean(parsed.username) && (parsed.protocol === 'http:' || parsed.protocol === 'https:');
}

function isParsableUrl(url: string): boolean {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

/**
 * NAME_MAX of the common filesystems (ext4, XFS, Btrfs, APFS): one path
 * component may hold at most 255 bytes. Every filesystem call on a longer
 * name fails with ENAMETOOLONG.
 */
const MAX_CLONE_DIRECTORY_NAME_BYTES = 255;

/**
 * The 400 every unusable clone URL gets. The reason is written for the person
 * reading the wizard's error banner and never echoes the URL, which may be a
 * pasted prompt or carry a credential.
 */
function invalidCloneUrlError(reason: string): AppError {
  return new AppError(`Invalid repository URL: ${reason}`, {
    code: 'INVALID_GITHUB_URL',
    statusCode: 400,
  });
}

/**
 * Names the directory the clone lands in after the URL's last path segment,
 * with trailing slashes and a `.git` suffix dropped.
 */
function deriveCloneDirectoryName(githubUrl: string): string {
  const sanitizedGithubUrl = githubUrl.replace(/\/+$/, '').replace(/\.git$/, '');
  return sanitizedGithubUrl.split('/').pop() || 'repository';
}

/**
 * Runs every check on a trimmed clone URL that needs neither the disk nor the
 * database, and returns the name of the directory the clone will land in.
 * Consumed by startCloneProject below and by the POST /clone route
 * (project-clone.routes.ts), so an API client gets a real 400 before anything
 * is parked. An empty URL passes; startCloneProject reports it as missing.
 *
 * It turns away what a prompt pasted into the URL field looks like — a line
 * break, which no remote, scp-like address or local path carries, or a last
 * segment too long to be a directory name — and a last segment that is not
 * one new directory inside the workspace. A space is refused only in an
 * http(s) URL: ssh, scp-like, file:// and local paths may hold one.
 * `pathApi` is the host's path module; tests pass `path.win32` to cover
 * Windows separators on any host.
 */
export function validateCloneUrl(githubUrl: string, pathApi: path.PlatformPath = path): string {
  if (githubUrl.startsWith('-')) {
    throw new AppError('Invalid githubUrl', {
      code: 'INVALID_GITHUB_URL',
      statusCode: 400,
    });
  }

  // \p{Cc} includes NUL, so no later check has to look for one.
  if (/[\p{Cc}\p{Zl}\p{Zp}]/u.test(githubUrl)) {
    throw invalidCloneUrlError('it contains a line break or another control character');
  }

  const cloneDirectoryName = deriveCloneDirectoryName(githubUrl);
  // `.` or `..` would put the clone in the workspace itself or its parent,
  // `.git` into the workspace's own git directory, and a name the platform
  // splits (`..\..\outside` on Windows) anywhere the separators lead.
  if (
    cloneDirectoryName === '.'
    || cloneDirectoryName === '..'
    || cloneDirectoryName.toLowerCase() === '.git'
    || pathApi.basename(cloneDirectoryName) !== cloneDirectoryName
  ) {
    throw invalidCloneUrlError('it does not end in a repository name');
  }

  if (Buffer.byteLength(cloneDirectoryName, 'utf8') > MAX_CLONE_DIRECTORY_NAME_BYTES) {
    throw invalidCloneUrlError(
      `its last part is longer than ${MAX_CLONE_DIRECTORY_NAME_BYTES} bytes, so it cannot be a folder name`,
    );
  }

  // An http(s) string the URL parser rejects (a bad port, a space in the
  // host) is one curl rejects too — but only after git has carried it, and
  // any credential in it, on its command line. A space in the path is one as
  // well: the parser percent-encodes it, curl refuses it as malformed.
  if (/^https?:/i.test(githubUrl)) {
    if (githubUrl.includes(' ')) {
      throw invalidCloneUrlError('a web address cannot contain spaces');
    }

    if (!isParsableUrl(githubUrl)) {
      throw invalidCloneUrlError('it is not a valid web address');
    }
  }

  if (carriesCredentials(githubUrl)) {
    // The token field is the only way in: a credential in the URL would ride
    // git's argv, its stderr and the clone's `.git/config`.
    throw new AppError('Put the token in the token field, not in the URL', {
      code: 'GITHUB_URL_CARRIES_CREDENTIALS',
      statusCode: 400,
    });
  }

  return cloneDirectoryName;
}

export async function startCloneProject(
  input: CloneProjectInput,
  handlers: CloneProjectEventHandlers,
  dependencyOverrides: Partial<CloneProjectDependencies> = {},
): Promise<CloneProjectOperation> {
  const dependencies = { ...defaultDependencies, ...dependencyOverrides };
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

  const repoName = validateCloneUrl(normalizedGithubUrl);

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

  const clonePath = path.join(absolutePath, repoName);

  let cloneTargetExists: boolean;
  try {
    cloneTargetExists = await dependencies.pathExists(clonePath);
  } catch (error) {
    // validateCloneUrl checks the name alone. The OS can still refuse the
    // whole path (over PATH_MAX, or over a smaller NAME_MAX such as eCryptfs's
    // 143 bytes), and its raw errno would echo that path, pasted text and all.
    const errorCode = (error as NodeJS.ErrnoException | null)?.code;
    if (errorCode === 'ENAMETOOLONG' || errorCode === 'EINVAL') {
      throw invalidCloneUrlError('its last part cannot be used as a folder name in this workspace');
    }

    throw error;
  }

  if (cloneTargetExists) {
    throw new AppError(
      `Directory "${repoName}" already exists. Please choose a different location or remove the existing directory.`,
      {
        code: 'CLONE_TARGET_ALREADY_EXISTS',
        statusCode: 409,
      },
    );
  }

  handlers.onProgress(`Cloning into '${repoName}'...`);
  const gitProcess = dependencies.spawnGitClone(
    normalizedGithubUrl,
    clonePath,
    buildGitCloneEnvironment(githubToken),
  );
  let lastError = '';

  // `git clone --progress` writes every byte of its progress to stderr. Git
  // was handed a credential-free URL, so each chunk is forwarded as it arrives.
  gitProcess.stdout?.on('data', (data: Buffer | string) => {
    const message = data.toString().trim();
    if (message) {
      handlers.onProgress(message);
    }
  });

  gitProcess.stderr?.on('data', (data: Buffer | string) => {
    const message = data.toString().trim();
    if (message) {
      lastError = message;
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
