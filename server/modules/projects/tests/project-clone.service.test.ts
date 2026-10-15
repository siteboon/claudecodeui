import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

import { startCloneProject, validateCloneUrl } from '@/modules/projects/services/project-clone.service.js';
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

for (const [label, githubUrl] of [
  ['a token as the user', 'https://ghp_supersecrettoken1234567890abcd@github.com/example/repo.git'],
  ['a user and password', 'https://user:ghp_supersecrettoken1234567890abcd@github.com/example/repo.git'],
  ['a password on an ssh URL', 'ssh://git:secret@github.com/example/repo.git'],
] as const) {
  test(`startCloneProject rejects a github URL carrying ${label} before git sees it`, async () => {
    // A credential in the URL would ride git's argv, its stderr and the
    // clone's `.git/config` — every channel the token field keeps it out of.
    let spawned = 0;
    await assert.rejects(
      async () =>
        startCloneProject(
          { workspacePath: '/workspace/root', githubUrl, userId: 1 },
          { onProgress: () => undefined, onComplete: () => undefined },
          buildDependencies({ spawnGitClone: () => { spawned += 1; throw new Error('must not spawn'); } }),
        ),
      (error: unknown) => {
        assert.ok(error instanceof AppError);
        assert.equal(error.code, 'GITHUB_URL_CARRIES_CREDENTIALS');
        assert.ok(!error.message.includes('ghp_supersecrettoken'), 'the error must not echo the credential');
        return true;
      },
    );
    assert.equal(spawned, 0);
  });
}

test('startCloneProject rejects an http(s) URL the parser cannot read before git carries it', async () => {
  // 'https://token@github.com:notaport/x' is no URL to the parser, so the
  // credential check could not see the token — and git would have had it on
  // its command line until curl refused the port.
  let spawned = 0;
  await assert.rejects(
    async () =>
      startCloneProject(
        { workspacePath: '/workspace/root', githubUrl: 'https://ghp_supersecrettoken1234567890abcd@github.com:notaport/example/repo.git', userId: 1 },
        { onProgress: () => undefined, onComplete: () => undefined },
        buildDependencies({ spawnGitClone: () => { spawned += 1; throw new Error('must not spawn'); } }),
      ),
    (error: unknown) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.code, 'INVALID_GITHUB_URL');
      return true;
    },
  );
  assert.equal(spawned, 0);
});

// A prompt pasted into the URL field: the browser's single-line input turns
// its line breaks into spaces, so what arrives has no slash and runs long.
const PASTED_PROMPT = [
  'Please audit this repository for security problems.',
  'Focus on the authentication flow, the websocket handlers and anything that touches the filesystem.',
  'Then write a short report with severity ratings and suggested fixes for each finding you make.',
  'Keep it concise and avoid speculative issues; cite file names and line numbers where possible.',
].join('\n');

const CONTROL_CHARACTER = 'it contains a line break or another control character';
const NOT_A_REPOSITORY_NAME = 'it does not end in a repository name';
const TOO_LONG = 'its last part is longer than 255 bytes, so it cannot be a folder name';

for (const [label, githubUrl, reason] of [
  ['a multi-line prompt', PASTED_PROMPT, CONTROL_CHARACTER],
  ['a prompt whose line breaks the browser turned into spaces', PASTED_PROMPT.replaceAll('\n', ' '), TOO_LONG],
  ['an https URL whose last segment is 256 bytes', `https://github.com/example/${'a'.repeat(256)}`, TOO_LONG],
  ['an https URL whose last segment is 130 two-byte characters', `https://github.com/example/${'é'.repeat(130)}`, TOO_LONG],
  ['a URL with a line break inside', 'https://github.com/example/\nrepo.git', CONTROL_CHARACTER],
  ['a URL with a tab inside', 'git@github.com:example/re\tpo.git', CONTROL_CHARACTER],
  ['a URL with a NUL byte inside', 'ssh://git@github.com/example/repo\u0000.git', CONTROL_CHARACTER],
  ['a URL with a Unicode line separator inside', 'https://github.com/example/re\u2028po.git', CONTROL_CHARACTER],
  ['an https URL with a space in its path', 'https://github.com/example/my repo.git', 'a web address cannot contain spaces'],
  ['an https URL the parser cannot read', 'https://github.com:notaport/example/repo.git', 'it is not a valid web address'],
  ['a URL ending in ..', 'https://github.com/example/..', NOT_A_REPOSITORY_NAME],
  ['a URL ending in /./', 'git@github.com:example/./', NOT_A_REPOSITORY_NAME],
  // `.git` is stripped once, leaving the workspace's own git directory.
  ['a URL ending in .git.git', 'https://github.com/example/.git.git', NOT_A_REPOSITORY_NAME],
  ['a URL ending in .GIT.git', 'git@github.com:example/.GIT.git', NOT_A_REPOSITORY_NAME],
] as const) {
  test(`startCloneProject rejects ${label} before touching the disk`, async () => {
    // The directory name used to reach the filesystem first: `access()` threw a
    // raw ENAMETOOLONG naming the whole pasted text, after the workspace had
    // already been created for a clone that could never run.
    const calls: string[] = [];
    await assert.rejects(
      async () =>
        startCloneProject(
          { workspacePath: '/workspace/root', githubUrl, githubTokenId: 3, userId: 1 },
          { onProgress: () => undefined, onComplete: () => undefined },
          buildDependencies({
            validatePath: async () => {
              calls.push('validatePath');
              return { valid: true, resolvedPath: '/workspace/root' };
            },
            ensureDirectory: async () => { calls.push('ensureDirectory'); },
            getGithubTokenById: async () => {
              calls.push('getGithubTokenById');
              return { github_token: 'token-value' };
            },
            pathExists: async () => {
              calls.push('pathExists');
              return false;
            },
            spawnGitClone: () => {
              calls.push('spawnGitClone');
              throw new Error('must not spawn');
            },
          }),
        ),
      (error: unknown) => {
        assert.ok(error instanceof AppError, `expected an AppError, got ${String(error)}`);
        assert.equal(error.code, 'INVALID_GITHUB_URL');
        assert.equal(error.statusCode, 400);
        // The wizard's banner shows this text as it is, so it says what is
        // wrong in words, and never echoes the pasted text.
        assert.equal(error.message, `Invalid repository URL: ${reason}`);
        return true;
      },
    );
    assert.deepEqual(calls, []);
  });
}

test('validateCloneUrl refuses a last segment the Windows path module would split', () => {
  // `\` is a separator on Windows only: path.win32.join('C:\\ws', '..\\..\\outside')
  // is 'C:\\outside', so the clone used to land outside the workspace there.
  const githubUrl = 'git@github.com:example/..\\..\\outside.git';
  assert.throws(
    () => validateCloneUrl(githubUrl, path.win32),
    (error: unknown) => {
      assert.ok(error instanceof AppError, `expected an AppError, got ${String(error)}`);
      assert.equal(error.code, 'INVALID_GITHUB_URL');
      assert.equal(error.message, `Invalid repository URL: ${NOT_A_REPOSITORY_NAME}`);
      return true;
    },
  );
  assert.throws(() => validateCloneUrl('C:repo', path.win32), AppError);

  // On POSIX a backslash is an ordinary name character: still one directory.
  assert.equal(validateCloneUrl(githubUrl, path.posix), '..\\..\\outside');
  assert.equal(validateCloneUrl('https://github.com/example/repo.git', path.win32), 'repo');
});

for (const code of ['ENAMETOOLONG', 'EINVAL']) {
  test(`startCloneProject turns ${code} from the clone-target check into a 400 that does not echo the path`, async () => {
    // The name passed every check, but the OS refused the whole path (over
    // PATH_MAX, or over a smaller NAME_MAX). Its raw errno names that path.
    let spawned = 0;
    await assert.rejects(
      async () =>
        startCloneProject(
          { workspacePath: '/workspace/root', githubUrl: 'https://github.com/example/repo.git', userId: 1 },
          { onProgress: () => undefined, onComplete: () => undefined },
          buildDependencies({
            pathExists: async (targetPath) => {
              throw Object.assign(new Error(`${code}: name too long, access '${targetPath}'`), { code });
            },
            spawnGitClone: () => { spawned += 1; throw new Error('must not spawn'); },
          }),
        ),
      (error: unknown) => {
        assert.ok(error instanceof AppError, `expected an AppError, got ${String(error)}`);
        assert.equal(error.code, 'INVALID_GITHUB_URL');
        assert.equal(error.statusCode, 400);
        assert.equal(
          error.message,
          'Invalid repository URL: its last part cannot be used as a folder name in this workspace',
        );
        return true;
      },
    );
    assert.equal(spawned, 0);
  });
}

test('startCloneProject passes any other error from the clone-target check through', async () => {
  const failure = Object.assign(new Error("EACCES: permission denied, access '/workspace/root/repo'"), { code: 'EACCES' });
  await assert.rejects(
    async () =>
      startCloneProject(
        { workspacePath: '/workspace/root', githubUrl: 'https://github.com/example/repo.git', userId: 1 },
        { onProgress: () => undefined, onComplete: () => undefined },
        buildDependencies({ pathExists: async () => { throw failure; } }),
      ),
    (error: unknown) => error === failure,
  );
});

for (const [label, githubUrl, expectedDirectory] of [
  ['an https URL', 'https://github.com/example/repo.git', 'repo'],
  ['an http URL', 'http://git.example.com/example/repo', 'repo'],
  ['a trailing slash', 'https://github.com/example/repo/', 'repo'],
  ['GitLab nested groups', 'https://gitlab.com/group/subgroup/repo.git', 'repo'],
  ['Bitbucket', 'https://bitbucket.org/workspace/repo.git', 'repo'],
  ['an ssh URL', 'ssh://git@example.com:2222/example/repo.git', 'repo'],
  ['an scp-like address', 'git@github.com:example/repo.git', 'repo'],
  ['a git:// URL', 'git://example.com/example/repo.git', 'repo'],
  ['a file:// URL', 'file:///srv/git/repo.git', 'repo'],
  ['a local path with a space', '/srv/git repos/my repo.git', 'my repo'],
  ['an scp-like address with a space', 'git@example.com:team/my repo.git', 'my repo'],
  ['a last segment of 100 two-byte characters', `https://github.com/example/${'é'.repeat(100)}`, 'é'.repeat(100)],
  ['a last segment of exactly 255 bytes', `https://github.com/example/${'a'.repeat(255)}.git`, 'a'.repeat(255)],
] as const) {
  test(`startCloneProject clones ${label}`, async () => {
    // The checks above only turn away what git or the filesystem never could
    // take; every remote shape git accepts still reaches it, unchanged.
    const gitProcess = createMockGitProcess();
    let spawnCall: { cloneUrl: string; clonePath: string } | null = null;
    const operation = await startCloneProject(
      { workspacePath: '/workspace/root', githubUrl, userId: 1 },
      { onProgress: () => undefined, onComplete: () => undefined },
      buildDependencies({
        spawnGitClone: (cloneUrl, clonePath) => {
          spawnCall = { cloneUrl, clonePath };
          return gitProcess as never;
        },
      }),
    );
    gitProcess.emit('close', 0);
    await operation.waitForCompletion;

    assert.deepEqual(spawnCall, { cloneUrl: githubUrl, clonePath: path.join('/workspace/root', expectedDirectory) });
  });
}

test('startCloneProject accepts the ssh login name that is not a credential', async () => {
  // `git@` on an SSH URL is the login every SSH clone uses, not a secret.
  const gitProcess = createMockGitProcess();
  const operation = await startCloneProject(
    { workspacePath: '/workspace/root', githubUrl: 'ssh://git@github.com/example/repo.git', userId: 1 },
    { onProgress: () => undefined, onComplete: () => undefined },
    buildDependencies({ spawnGitClone: () => gitProcess as never }),
  );
  gitProcess.emit('close', 0);
  await operation.waitForCompletion;
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

type SpawnCall = { cloneUrl: string; clonePath: string; environment: NodeJS.ProcessEnv };

/**
 * Runs a clone against a mock git process and captures exactly what would be
 * handed to `spawn`: the URL and path (the only variable argv elements) and
 * the environment. The token has to reach git through the environment alone.
 */
async function captureSpawnCall(input: {
  githubTokenId?: number;
  newGithubToken?: string;
  storedToken?: string;
}): Promise<SpawnCall> {
  const gitProcess = createMockGitProcess();
  let spawnCall: SpawnCall | null = null;

  const operation = await startCloneProject(
    {
      workspacePath: '/workspace/root',
      githubUrl: 'https://github.com/example/repo.git',
      githubTokenId: input.githubTokenId,
      newGithubToken: input.newGithubToken,
      userId: 1,
    },
    {
      onProgress: () => undefined,
      onComplete: () => undefined,
    },
    buildDependencies({
      getGithubTokenById: async () => ({ github_token: input.storedToken ?? 'unused' }),
      spawnGitClone: (cloneUrl, clonePath, environment) => {
        spawnCall = { cloneUrl, clonePath, environment };
        return gitProcess as any;
      },
    }),
  );

  gitProcess.emit('close', 0);
  await operation.waitForCompletion;

  assert.notEqual(spawnCall, null, 'git was never spawned');
  return spawnCall as unknown as SpawnCall;
}

for (const [label, input, token] of [
  ['a stored token', { githubTokenId: 7, storedToken: 'ghp_storedsecret1234567890' }, 'ghp_storedsecret1234567890'],
  // Characters `url.username=` would have percent-encoded, so a check for the
  // raw token alone could not have caught the URL channel.
  ['a new token', { newGithubToken: 'ghp_new:secret@with/odd-chars' }, 'ghp_new:secret@with/odd-chars'],
] as const) {
  test(`startCloneProject hands git ${label} through the credential helper, never the clone URL`, async () => {
    const { cloneUrl, clonePath, environment } = await captureSpawnCall(input);

    // The URL git receives is the one the user typed: no username, no password,
    // nothing encoded — so neither argv, stderr nor `.git/config` can carry it.
    assert.equal(cloneUrl, 'https://github.com/example/repo.git');
    assert.equal(clonePath, path.join('/workspace/root', 'repo'));

    assert.equal(environment.CLOUDCLI_GITHUB_TOKEN, token);
    assert.equal(environment.GIT_CONFIG_COUNT, '2');
    assert.equal(environment.GIT_CONFIG_KEY_0, 'credential.helper');
    assert.equal(environment.GIT_CONFIG_VALUE_0, '');
    assert.equal(environment.GIT_CONFIG_KEY_1, 'credential.https://github.com.helper');
    assert.match(environment.GIT_CONFIG_VALUE_1 ?? '', /\$CLOUDCLI_GITHUB_TOKEN/);
    assert.equal(environment.GIT_TERMINAL_PROMPT, '0');

    // The helper's command line is itself a process argv, so the token must be
    // read from the variable rather than pasted into the helper text.
    for (const [name, value] of Object.entries(environment)) {
      if (name === 'CLOUDCLI_GITHUB_TOKEN') {
        continue;
      }
      assert.ok(!(value ?? '').includes(token), `token leaked into ${name}`);
    }
  });
}

test('startCloneProject leaves the credential helper unset when no token was given', async () => {
  const { cloneUrl, environment } = await captureSpawnCall({});

  assert.equal(cloneUrl, 'https://github.com/example/repo.git');
  assert.equal(environment.GIT_TERMINAL_PROMPT, '0');
  assert.equal(environment.GIT_CONFIG_COUNT, undefined);
  assert.equal(environment.CLOUDCLI_GITHUB_TOKEN, undefined);
});

/**
 * `git clone --progress` writes every byte of its progress to stderr — stdout
 * stays empty — so these tests drive stderr, the pipe that carries the progress
 * the user watches and the reason a clone failed.
 */
async function runCloneWithStderr(
  chunks: string[],
  exitCode: number | null,
): Promise<{ progressMessages: string[]; failure: AppError | null }> {
  const gitProcess = createMockGitProcess();
  const progressMessages: string[] = [];

  const operation = await startCloneProject(
    {
      workspacePath: '/workspace/root',
      githubUrl: 'https://github.com/example/repo.git',
      newGithubToken: 'ghp_supersecrettoken1234567890abcd',
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

test('startCloneProject forwards each stderr chunk to onProgress as it arrives', async () => {
  const gitProcess = createMockGitProcess();
  const progressMessages: string[] = [];

  const operation = await startCloneProject(
    {
      workspacePath: '/workspace/root',
      githubUrl: 'https://github.com/example/repo.git',
      newGithubToken: 'ghp_supersecrettoken1234567890abcd',
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

  assert.deepEqual(progressMessages, ["Cloning into 'repo'..."]);

  // Each chunk has to surface on its own event before the next one is written
  // and long before the process exits: the progress UI is fed by these events,
  // so anything buffered until close would leave the user staring at nothing.
  const chunks = [
    'remote: Enumerating objects: 20, done.\n',
    'Receiving objects:  45% (9/20)\r',
    'Receiving objects: 100% (20/20), done.\n',
  ];
  for (const [index, chunk] of chunks.entries()) {
    gitProcess.stderr.write(chunk);
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(
      progressMessages,
      ["Cloning into 'repo'...", ...chunks.slice(0, index + 1).map((line) => line.trim())],
      `chunk ${index + 1} did not arrive on its own event`,
    );
  }

  gitProcess.stderr.end();
  gitProcess.emit('close', 0);
  await operation.waitForCompletion;

  assert.deepEqual(progressMessages, [
    "Cloning into 'repo'...",
    'remote: Enumerating objects: 20, done.',
    'Receiving objects:  45% (9/20)',
    'Receiving objects: 100% (20/20), done.',
  ]);
});

test('startCloneProject reports the git failure reason from stderr', async () => {
  const { failure } = await runCloneWithStderr(
    ["remote: Repository not found.\nfatal: repository 'https://github.com/example/repo.git/' not found\n"],
    128,
  );

  assert.equal(failure?.code, 'GIT_CLONE_FAILED');
  assert.equal(failure?.message, 'Repository not found. Please check the URL and ensure you have access.');
});

test('startCloneProject falls back to the last stderr text for an unrecognised failure', async () => {
  const { failure } = await runCloneWithStderr(
    ["fatal: unable to access 'https://github.com/example/repo.git/': SSL error\n"],
    128,
  );

  assert.equal(failure?.code, 'GIT_CLONE_FAILED');
  assert.equal(failure?.message, "fatal: unable to access 'https://github.com/example/repo.git/': SSL error");
});

const execFileAsync = promisify(execFile);

/**
 * Real git, real clone: proves the credential-helper environment is something
 * git accepts, and that the resulting repository records a credential-free
 * remote. The `file://` transport never asks the helper for anything, so a
 * placeholder token stands in for the real one.
 */
test('startCloneProject clones a real repository with the credential helper in git environment', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'project-clone-service-'));
  try {
    const seedPath = path.join(root, 'seed');
    const originPath = path.join(root, 'origin.git');
    const workspacePath = path.join(root, 'workspace');
    await execFileAsync('git', ['init', '-q', seedPath]);
    await execFileAsync('git', [
      '-C', seedPath,
      '-c', 'user.email=clone@example.test',
      '-c', 'user.name=Clone Test',
      'commit', '-q', '--allow-empty', '-m', 'initial',
    ]);
    await execFileAsync('git', ['clone', '-q', '--bare', seedPath, originPath]);

    const originUrl = pathToFileURL(originPath).href;
    const token = 'ghp_placeholder-file-transport-never-asks';
    const progressMessages: string[] = [];
    let completeMessage = '';

    const operation = await startCloneProject(
      {
        workspacePath,
        githubUrl: originUrl,
        newGithubToken: token,
        userId: 1,
      },
      {
        onProgress: (message) => {
          progressMessages.push(message);
        },
        onComplete: ({ message }) => {
          completeMessage = message;
        },
      },
      {
        validatePath: async () => ({ valid: true, resolvedPath: workspacePath }),
        registerProject: async (projectPath, customName) => ({
          project: { path: projectPath, name: customName },
        }),
      },
    );
    await operation.waitForCompletion;

    assert.equal(completeMessage, 'Repository cloned successfully');
    // The first message is synthesised by the service; everything after it
    // came off git's own stderr, which is what the progress UI relies on.
    assert.ok(
      progressMessages.length >= 2,
      `no progress arrived from git: ${JSON.stringify(progressMessages)}`,
    );

    const cloneConfig = await readFile(path.join(workspacePath, 'origin', '.git', 'config'), 'utf8');
    assert.match(cloneConfig, new RegExp(`url = ${originUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
    assert.ok(!cloneConfig.includes(token), `token written to .git/config: ${cloneConfig}`);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('startCloneProject offers the GitHub token to no host but github.com', async () => {
  // The helper used to answer every credential challenge: a clone from any
  // host the user typed — over plain http too — received the GitHub token.
  // Real git against a local server that challenges for Basic auth.
  const root = await mkdtemp(path.join(os.tmpdir(), 'project-clone-scope-'));
  const authorizations: Array<string | null> = [];
  const server = http.createServer((request, response) => {
    authorizations.push(request.headers.authorization ?? null);
    response.writeHead(401, { 'WWW-Authenticate': 'Basic realm="probe"' });
    response.end('auth required');
  });
  await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve); });
  const { port } = server.address() as AddressInfo;
  const token = 'ghp_supersecrettoken1234567890abcd';

  try {
    let failure = '';
    const operation = await startCloneProject(
      { workspacePath: root, githubUrl: `http://127.0.0.1:${port}/example/repo.git`, newGithubToken: token, userId: 1 },
      { onProgress: () => undefined, onComplete: () => undefined },
      { validatePath: async () => ({ valid: true, resolvedPath: root }) },
    );
    await operation.waitForCompletion.catch((error: unknown) => { failure = error instanceof Error ? error.message : String(error); });

    assert.ok(authorizations.length >= 1, 'git never reached the server');
    assert.ok(
      authorizations.every((authorization) => authorization === null),
      `the token was offered to a foreign host: ${JSON.stringify(authorizations)}`,
    );
    assert.match(failure, /Authentication failed/);
  } finally {
    server.close();
    await rm(root, { recursive: true, force: true });
  }
});

