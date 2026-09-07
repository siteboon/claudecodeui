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

/**
 * `git clone --progress` writes every byte of its progress to stderr — stdout
 * stays empty — so these tests drive stderr, the pipe that actually carries
 * both the progress the user watches and the URL that leaks the token.
 */
async function runCloneWithStderr(
  chunks: string[],
  token: string,
  exitCode: number | null,
): Promise<{ progressMessages: string[]; failure: AppError | null }> {
  const gitProcess = createMockGitProcess();
  const progressMessages: string[] = [];

  const operation = await startCloneProject(
    {
      workspacePath: '/workspace/root',
      githubUrl: 'https://github.com/example/repo.git',
      newGithubToken: token,
      userId: 1,
    },
    {
      onProgress: (message) => {
        progressMessages.push(message);
      },
      onComplete: () => undefined,
    },
    buildDependencies({ spawnGitClone: () => gitProcess as any }),
  );

  for (const chunk of chunks) {
    gitProcess.stderr.write(chunk);
  }
  gitProcess.stderr.end();
  // Let the PassThrough deliver every `data` event and its `end` before the
  // process is reported closed, exactly as a real pipe does.
  await new Promise((resolve) => setImmediate(resolve));
  gitProcess.emit('close', exitCode);

  let failure: AppError | null = null;
  try {
    await operation.waitForCompletion;
  } catch (error) {
    failure = error as AppError;
  }

  return { progressMessages, failure };
}

test('startCloneProject keeps the github token out of the clone progress stream', async () => {
  const token = 'ghp_supersecrettoken1234567890abcd';
  const { progressMessages, failure } = await runCloneWithStderr(
    [`fatal: could not read Password for 'https://${token}@github.com': terminal prompts disabled\n`],
    token,
    128,
  );

  const streamed = progressMessages.join('\n');
  assert.ok(!streamed.includes(token), `token leaked into the progress stream: ${streamed}`);
  assert.ok(streamed.includes('***@github.com'), `token was not redacted: ${streamed}`);
  assert.ok(!(failure?.message ?? '').includes(token), 'token leaked into the failure message');
});

test('startCloneProject redacts a github token split across stderr chunks', async () => {
  const token = 'ghp_supersecrettoken1234567890abcd';
  const { progressMessages } = await runCloneWithStderr(
    [`fatal: could not read Password for 'https://ghp_supersecret`, `token1234567890abcd@github.com'\n`],
    token,
    128,
  );

  const streamed = progressMessages.join('');
  assert.ok(!streamed.includes(token), `token leaked across the chunk boundary: ${streamed}`);
  assert.ok(streamed.includes('***@github.com'), `split token was not redacted: ${streamed}`);
});

test('startCloneProject still streams clone progress while a token is being redacted', async () => {
  const token = 'ghp_supersecrettoken1234567890abcd';
  const { progressMessages } = await runCloneWithStderr(
    [
      "Cloning into 'repo'...\n",
      'remote: Enumerating objects: 13, done.\n',
      'Receiving objects:  53% (7/13)\r',
      'Receiving objects: 100% (13/13), done.\n',
    ],
    token,
    0,
  );

  // Redaction must not swallow, delay or reorder the progress the user watches:
  // every line has to arrive, and each on its own event rather than as one
  // lump once the stream closes.
  const streamed = progressMessages.join('\n');
  assert.ok(streamed.includes("Cloning into 'repo'..."), streamed);
  assert.ok(streamed.includes('remote: Enumerating objects: 13, done.'), streamed);
  assert.ok(streamed.includes('Receiving objects:  53% (7/13)'), streamed);
  assert.ok(streamed.includes('Receiving objects: 100% (13/13), done.'), streamed);
  assert.ok(
    progressMessages.filter((message) => message.startsWith('Receiving objects')).length >= 2,
    `progress arrived in one lump instead of per chunk: ${JSON.stringify(progressMessages)}`,
  );
});

test('startCloneProject reports the git failure reason from redacted stderr', async () => {
  const token = 'ghp_supersecrettoken1234567890abcd';
  const { failure } = await runCloneWithStderr(
    [`remote: Repository not found.\nfatal: repository 'https://${token}@github.com/example/repo.git/' not found\n`],
    token,
    128,
  );

  assert.equal(failure?.code, 'GIT_CLONE_FAILED');
  assert.equal(failure?.message, 'Repository not found. Please check the URL and ensure you have access.');
});

test('startCloneProject falls back to the redacted stderr text for an unrecognised failure', async () => {
  const token = 'ghp_supersecrettoken1234567890abcd';
  const { failure } = await runCloneWithStderr(
    [`fatal: unable to access 'https://${token}@github.com/example/repo.git/': SSL error\n`],
    token,
    128,
  );

  assert.ok(!(failure?.message ?? '').includes(token), `token leaked into the failure message: ${failure?.message}`);
  assert.ok((failure?.message ?? '').includes('SSL error'), failure?.message);
});

test('startCloneProject never emits a token fragment left over when stderr stops mid-credential', async () => {
  const token = 'ghp_supersecrettoken1234567890abcd';
  const { progressMessages } = await runCloneWithStderr(
    // No trailing newline: the stream dies part-way through the credential, so
    // the redactor is still holding a prefix of it when the pipe closes.
    [`fatal: could not read Password for 'https://ghp_supersecrettoken`],
    token,
    128,
  );

  const streamed = progressMessages.join('');
  assert.ok(!streamed.includes('ghp_supersecrettoken'), `token fragment leaked on flush: ${streamed}`);
  assert.ok(streamed.includes("fatal: could not read Password for 'https://"), streamed);
});
