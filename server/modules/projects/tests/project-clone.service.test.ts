import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import test from 'node:test';

import { startCloneProject } from '@/modules/projects/services/project-clone.service.js';
import { AppError } from '@/shared/utils.js';

type TestDependencies = Parameters<typeof startCloneProject>[2];

function buildDependencies(overrides: Partial<NonNullable<TestDependencies>> = {}): NonNullable<TestDependencies> {
  return {
    validatePath: async () => ({ valid: true, resolvedPath: '/workspace/root' }),
    ensureDirectory: async () => undefined,
    pathExists: async () => false,
    removePath: async () => undefined,
    getCredentialById: async () => ({ credential_value: 'token-value' }),
    spawnGitClone: () => {
      throw new Error('spawnGitClone should be overridden in this test');
    },
    registerProject: async () => ({ project: { projectId: 'project-1' } }),
    logError: () => undefined,
    ...overrides,
  };
}

function createMockGitProcess() {
  const emitter = new EventEmitter() as EventEmitter & {
    stdout: PassThrough;
    stderr: PassThrough;
    kill: () => void;
  };

  emitter.stdout = new PassThrough();
  emitter.stderr = new PassThrough();
  emitter.kill = () => {
    emitter.emit('close', null);
  };

  return emitter;
}

test('startCloneProject rejects when workspace path is missing', async () => {
  await assert.rejects(
    async () =>
      startCloneProject(
        {
          workspacePath: '',
          githubUrl: 'https://github.com/example/repo',
          userId: 1,
        },
        {
          onProgress: () => undefined,
          onComplete: () => undefined,
        },
        buildDependencies(),
      ),
    (error: unknown) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.code, 'WORKSPACE_PATH_REQUIRED');
      return true;
    },
  );
});

test('startCloneProject rejects when github URL is missing', async () => {
  await assert.rejects(
    async () =>
      startCloneProject(
        {
          workspacePath: '/workspace/root',
          githubUrl: '',
          userId: 1,
        },
        {
          onProgress: () => undefined,
          onComplete: () => undefined,
        },
        buildDependencies(),
      ),
    (error: unknown) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.code, 'GITHUB_URL_REQUIRED');
      return true;
    },
  );
});

test('startCloneProject rejects github URL values that begin with option prefixes', async () => {
  await assert.rejects(
    async () =>
      startCloneProject(
        {
          workspacePath: '/workspace/root',
          githubUrl: '--upload-pack=malicious',
          userId: 1,
        },
        {
          onProgress: () => undefined,
          onComplete: () => undefined,
        },
        buildDependencies(),
      ),
    (error: unknown) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.code, 'INVALID_GITHUB_URL');
      return true;
    },
  );
});

test('startCloneProject rejects when selected github token does not exist', async () => {
  await assert.rejects(
    async () =>
      startCloneProject(
        {
          workspacePath: '/workspace/root',
          githubUrl: 'https://github.com/example/repo',
          githubTokenId: 12,
          userId: 1,
        },
        {
          onProgress: () => undefined,
          onComplete: () => undefined,
        },
        buildDependencies({
          getCredentialById: async () => null,
        }),
      ),
    (error: unknown) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.code, 'GITHUB_TOKEN_NOT_FOUND');
      return true;
    },
  );
});

test('startCloneProject completes and emits complete payload when git exits successfully', async () => {
  const gitProcess = createMockGitProcess();
  const progressMessages: string[] = [];
  let completePayload: { project: Record<string, unknown>; message: string } | null = null;
  let capturedProjectPath = '';
  let capturedCustomName = '';

  const operation = await startCloneProject(
    {
      workspacePath: '/workspace/root',
      githubUrl: 'https://github.com/example/repo.git',
      userId: 1,
    },
    {
      onProgress: (message) => {
        progressMessages.push(message);
      },
      onComplete: (payload: { project: Record<string, unknown>; message: string }) => {
        completePayload = payload;
      },
    },
    buildDependencies({
      spawnGitClone: () => gitProcess as any,
      registerProject: async (projectPath, customName) => {
        capturedProjectPath = projectPath;
        capturedCustomName = customName;
        return { project: { projectId: 'project-1', path: projectPath } };
      },
    }),
  );

  gitProcess.emit('close', 0);
  await operation.waitForCompletion;

  assert.ok(progressMessages.some((message) => message.includes("Cloning into 'repo'")));
  assert.equal(capturedCustomName, 'repo');
  assert.equal(path.basename(capturedProjectPath), 'repo');
  assert.notEqual(completePayload, null);
  const resolvedCompletePayload = completePayload as unknown as {
    project: Record<string, unknown>;
    message: string;
  };
  assert.equal(resolvedCompletePayload.message, 'Repository cloned successfully');
  assert.equal((resolvedCompletePayload.project.projectId as string) || '', 'project-1');
});

test('startCloneProject injects GitLab oauth2 credentials for a gitlab.com URL', async () => {
  const gitProcess = createMockGitProcess();
  let capturedCloneUrl = '';

  const operation = await startCloneProject(
    {
      workspacePath: '/workspace/root',
      githubUrl: 'https://gitlab.com/example/repo',
      gitProvider: 'gitlab',
      newGithubToken: 'glpat-secret',
      userId: 1,
    },
    {
      onProgress: () => undefined,
      onComplete: () => undefined,
    },
    buildDependencies({
      spawnGitClone: (cloneUrl) => {
        capturedCloneUrl = cloneUrl;
        return gitProcess as any;
      },
    }),
  );

  gitProcess.emit('close', 0);
  await operation.waitForCompletion;

  assert.ok(capturedCloneUrl.startsWith('https://oauth2:glpat-secret@gitlab.com/'));
});

test('startCloneProject injects Bitbucket x-token-auth credentials for a bitbucket.org URL', async () => {
  const gitProcess = createMockGitProcess();
  let capturedCloneUrl = '';

  const operation = await startCloneProject(
    {
      workspacePath: '/workspace/root',
      githubUrl: 'https://bitbucket.org/example/repo',
      gitProvider: 'bitbucket',
      newGithubToken: 'bb-secret',
      userId: 1,
    },
    {
      onProgress: () => undefined,
      onComplete: () => undefined,
    },
    buildDependencies({
      spawnGitClone: (cloneUrl) => {
        capturedCloneUrl = cloneUrl;
        return gitProcess as any;
      },
    }),
  );

  gitProcess.emit('close', 0);
  await operation.waitForCompletion;

  assert.ok(capturedCloneUrl.startsWith('https://x-bitbucket-api-token-auth:bb-secret@bitbucket.org/'));
});

test('startCloneProject rejects when the URL host does not match the selected provider', async () => {
  await assert.rejects(
    async () =>
      startCloneProject(
        {
          workspacePath: '/workspace/root',
          githubUrl: 'https://bitbucket.org/example/repo',
          gitProvider: 'github',
          userId: 1,
        },
        {
          onProgress: () => undefined,
          onComplete: () => undefined,
        },
        buildDependencies(),
      ),
    (error: unknown) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.code, 'GIT_PROVIDER_HOST_MISMATCH');
      return true;
    },
  );
});

test('startCloneProject skips host validation and uses generic auth for gitProvider "custom"', async () => {
  const gitProcess = createMockGitProcess();
  let capturedCloneUrl = '';

  const operation = await startCloneProject(
    {
      workspacePath: '/workspace/root',
      githubUrl: 'https://git.example.internal/example/repo',
      gitProvider: 'custom',
      newGithubToken: 'custom-secret',
      userId: 1,
    },
    {
      onProgress: () => undefined,
      onComplete: () => undefined,
    },
    buildDependencies({
      spawnGitClone: (cloneUrl) => {
        capturedCloneUrl = cloneUrl;
        return gitProcess as any;
      },
    }),
  );

  gitProcess.emit('close', 0);
  await operation.waitForCompletion;

  assert.ok(capturedCloneUrl.startsWith('https://custom-secret@git.example.internal/'));
});

test('startCloneProject rejects a stored credential whose type does not match the selected provider', async () => {
  await assert.rejects(
    async () =>
      startCloneProject(
        {
          workspacePath: '/workspace/root',
          githubUrl: 'https://gitlab.com/example/repo',
          gitProvider: 'gitlab',
          githubTokenId: 12,
          userId: 1,
        },
        {
          onProgress: () => undefined,
          onComplete: () => undefined,
        },
        buildDependencies({
          // Mirrors the real DB-backed implementation: a credential stored as
          // github_token is invisible when looked up as gitlab_token, so a
          // cross-provider credential ID can't leak a different provider's secret.
          getCredentialById: async (_credentialId, _userId, credentialType) =>
            credentialType === 'github_token' ? { credential_value: 'github-secret' } : null,
        }),
      ),
    (error: unknown) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.code, 'GITHUB_TOKEN_NOT_FOUND');
      return true;
    },
  );
});

test('startCloneProject rejects a stored-credential selection for gitProvider "custom"', async () => {
  await assert.rejects(
    async () =>
      startCloneProject(
        {
          workspacePath: '/workspace/root',
          githubUrl: 'https://git.example.internal/example/repo',
          gitProvider: 'custom',
          githubTokenId: 12,
          userId: 1,
        },
        {
          onProgress: () => undefined,
          onComplete: () => undefined,
        },
        buildDependencies({
          spawnGitClone: () => {
            throw new Error('spawnGitClone must not run for a rejected custom stored-credential request');
          },
        }),
      ),
    (error: unknown) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.code, 'CUSTOM_PROVIDER_NO_STORED_CREDENTIAL');
      return true;
    },
  );
});

test('startCloneProject rejects a non-HTTPS URL before attaching credentials', async () => {
  await assert.rejects(
    async () =>
      startCloneProject(
        {
          workspacePath: '/workspace/root',
          githubUrl: 'http://github.com/example/repo',
          newGithubToken: 'plain-secret',
          userId: 1,
        },
        {
          onProgress: () => undefined,
          onComplete: () => undefined,
        },
        buildDependencies({
          spawnGitClone: () => {
            throw new Error('spawnGitClone must not run for a rejected non-HTTPS URL');
          },
        }),
      ),
    (error: unknown) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.code, 'INVALID_GITHUB_URL');
      return true;
    },
  );
});

test('startCloneProject validates the host of an SCP-style SSH URL against the selected provider', async () => {
  await assert.rejects(
    async () =>
      startCloneProject(
        {
          workspacePath: '/workspace/root',
          githubUrl: 'git@gitlab.com:example/repo.git',
          gitProvider: 'github',
          userId: 1,
        },
        {
          onProgress: () => undefined,
          onComplete: () => undefined,
        },
        buildDependencies({
          spawnGitClone: () => {
            throw new Error('spawnGitClone must not run for a mismatched SSH host');
          },
        }),
      ),
    (error: unknown) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.code, 'GIT_PROVIDER_HOST_MISMATCH');
      return true;
    },
  );
});

test('startCloneProject clones a matching SCP-style SSH URL as-is', async () => {
  const gitProcess = createMockGitProcess();
  let capturedCloneUrl = '';

  const operation = await startCloneProject(
    {
      workspacePath: '/workspace/root',
      githubUrl: 'git@github.com:example/repo.git',
      gitProvider: 'github',
      userId: 1,
    },
    {
      onProgress: () => undefined,
      onComplete: () => undefined,
    },
    buildDependencies({
      spawnGitClone: (cloneUrl) => {
        capturedCloneUrl = cloneUrl;
        return gitProcess as any;
      },
    }),
  );

  gitProcess.emit('close', 0);
  await operation.waitForCompletion;

  assert.equal(capturedCloneUrl, 'git@github.com:example/repo.git');
});
