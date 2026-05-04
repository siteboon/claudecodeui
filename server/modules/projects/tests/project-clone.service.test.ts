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
    getGithubTokenById: async () => ({ github_token: 'token-value' }),
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
          getGithubTokenById: async () => null,
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
