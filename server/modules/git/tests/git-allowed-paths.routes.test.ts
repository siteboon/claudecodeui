import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import * as fsPromises from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import test, { after } from 'node:test';

import express from 'express';

// ALLOWED_PATHS is read when the shared utils module is first evaluated, so it
// is set before the router is imported.
const fixtureRoot = await fsPromises.realpath(await fsPromises.mkdtemp(path.join(os.tmpdir(), 'git-allowed-')));
const allowedDirectory = path.join(fixtureRoot, 'allowed');
const insideProjectRoot = path.join(allowedDirectory, 'repo');
const outsideProjectRoot = path.join(fixtureRoot, 'outside', 'repo');
const secretFilePath = path.join(outsideProjectRoot, 'secret.txt');
// A monorepo whose root is above the one allowed package, and a linked
// worktree inside the allowed directory whose git directory is outside it.
const monorepoRoot = path.join(fixtureRoot, 'mono');
const monorepoPackagePath = path.join(monorepoRoot, 'packages', 'app');
const linkedWorktreePath = path.join(allowedDirectory, 'linked');
const SECRET = 'TOP SECRET';
await fsPromises.mkdir(insideProjectRoot, { recursive: true });
await fsPromises.mkdir(outsideProjectRoot, { recursive: true });
await fsPromises.mkdir(monorepoPackagePath, { recursive: true });
await fsPromises.mkdir(linkedWorktreePath, { recursive: true });
await fsPromises.writeFile(secretFilePath, SECRET, 'utf8');
await fsPromises.writeFile(path.join(insideProjectRoot, 'notes.txt'), 'hello inside', 'utf8');
await fsPromises.symlink(outsideProjectRoot, path.join(insideProjectRoot, 'escape'));
await fsPromises.symlink(secretFilePath, path.join(insideProjectRoot, 'secretlink.txt'));

const previousAllowedPaths = process.env.ALLOWED_PATHS;
process.env.ALLOWED_PATHS = `${allowedDirectory},${monorepoPackagePath}`;

const { createGitRouter } = await import('@/modules/git/git.routes.js');
const { PATH_NOT_ALLOWED_MESSAGE } = await import('@/shared/utils.js');
const GIT_REPOSITORY_NOT_ALLOWED_MESSAGE =
  'The Git repository that contains this project is outside the directories allowed by ALLOWED_PATHS';

after(async () => {
  if (previousAllowedPaths === undefined) {
    delete process.env.ALLOWED_PATHS;
  } else {
    process.env.ALLOWED_PATHS = previousAllowedPaths;
  }
  await fsPromises.rm(fixtureRoot, { recursive: true, force: true });
});

type SpawnProcess = Parameters<typeof createGitRouter>[0]['spawnProcess'];
type GitCall = { args: string[]; cwd: string };

// `rev-parse --show-toplevel --git-common-dir` answers per working directory;
// any other directory is its own repository root with a local `.git`.
const repositoryLayouts: Record<string, { root: string; commonDirectory: string }> = {
  [monorepoPackagePath]: { root: monorepoRoot, commonDirectory: '../../.git' },
  [linkedWorktreePath]: { root: linkedWorktreePath, commonDirectory: path.join(outsideProjectRoot, '.git') },
};

/**
 * Answers the git commands the routes under test run: the repository checks,
 * the top level and git directory, a merge base, and every path asked about
 * as untracked.
 */
function createFakeGit(calls: GitCall[]): SpawnProcess {
  return ((_command: string, args: string[], options?: { cwd?: string }) => {
    const cwd = String(options?.cwd);
    calls.push({ args, cwd });
    const child = new EventEmitter() as EventEmitter & { stdout: PassThrough; stderr: PassThrough };
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    const pathArgument = args.includes('--') ? args[args.indexOf('--') + 1] : '';
    const layout = repositoryLayouts[cwd] ?? { root: cwd, commonDirectory: '.git' };
    let stdout = '';
    if (args[0] === 'rev-parse' && args[1] === '--is-inside-work-tree') stdout = 'true\n';
    if (args[0] === 'rev-parse' && args[1] === '--show-toplevel') {
      stdout = args.includes('--git-common-dir') ? `${layout.root}\n${layout.commonDirectory}\n` : `${layout.root}\n`;
    }
    if (args[0] === 'merge-base') stdout = '1111111111111111111111111111111111111111\n';
    if (args[0] === 'ls-files' && pathArgument) stdout = `${pathArgument}\0`;
    if (args[0] === 'status' && pathArgument) stdout = `?? ${pathArgument}\n`;
    process.nextTick(() => {
      child.stdout.write(stdout);
      child.emit('close', 0);
    });
    return child;
  }) as SpawnProcess;
}

async function withGitServer(
  calls: GitCall[],
  run: (baseUrl: string) => Promise<void>,
  prompts: string[] = [],
): Promise<void> {
  const unexpectedProvider = async (): Promise<never> => { throw new Error('unexpected provider call'); };
  const projectRoots: Record<string, string> = {
    inside: insideProjectRoot,
    outside: outsideProjectRoot,
    mono: monorepoPackagePath,
    linked: linkedWorktreePath,
  };
  const app = express();
  app.use(express.json());
  app.use('/api/git', createGitRouter({
    fileSystem: fsPromises,
    spawnProcess: createFakeGit(calls),
    // Indexing coerces an array id to its single element, as better-sqlite3
    // binds a one-element array.
    resolveProjectPathById: (projectId) => projectRoots[projectId] ?? null,
    queryClaude: async (prompt) => {
      prompts.push(String(prompt));
    },
    queryCursor: unexpectedProvider,
  }));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    await run(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

function postJson(url: string, body: unknown): Promise<Response> {
  return fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function callsOutsideAllowedPaths(calls: GitCall[]): GitCall[] {
  return calls.filter(({ cwd }) => cwd.startsWith(outsideProjectRoot) || cwd === monorepoRoot);
}

test('a project outside ALLOWED_PATHS is refused with 403 before any git command runs', async () => {
  const calls: GitCall[] = [];

  await withGitServer(calls, async (baseUrl) => {
    const status = await fetch(`${baseUrl}/api/git/status?project=outside`);
    assert.equal(status.status, 403);
    assert.deepEqual(await status.json(), { error: PATH_NOT_ALLOWED_MESSAGE });

    const discard = await postJson(`${baseUrl}/api/git/discard`, { project: 'outside', file: 'secret.txt' });
    assert.equal(discard.status, 403);
  });

  assert.deepEqual(calls, []);
  assert.equal(await fsPromises.readFile(secretFilePath, 'utf8'), SECRET);
});

test('a project inside ALLOWED_PATHS reaches its git route', async () => {
  const calls: GitCall[] = [];

  await withGitServer(calls, async (baseUrl) => {
    const status = await fetch(`${baseUrl}/api/git/status?project=inside`);
    assert.notEqual(status.status, 403);
  });

  assert.ok(calls.some(({ args }) => args[0] === 'status'));
});

test('an allowed id in the query does not let the body name an outside project', async () => {
  const calls: GitCall[] = [];

  await withGitServer(calls, async (baseUrl) => {
    const commit = await postJson(`${baseUrl}/api/git/commit?project=inside`, {
      project: 'outside',
      message: 'm',
      files: ['secret.txt'],
    });
    assert.equal(commit.status, 403);

    const checkout = await postJson(`${baseUrl}/api/git/checkout?project=`, { project: 'outside', branch: 'main' });
    assert.equal(checkout.status, 403);
  });

  assert.deepEqual(callsOutsideAllowedPaths(calls), []);
});

test('an unknown id in the query does not stop the body id from being checked', async () => {
  const calls: GitCall[] = [];

  await withGitServer(calls, async (baseUrl) => {
    const commit = await postJson(`${baseUrl}/api/git/commit?project=unknown`, {
      project: 'outside',
      message: 'm',
      files: ['secret.txt'],
    });
    assert.equal(commit.status, 403);
    assert.deepEqual(await commit.json(), { error: PATH_NOT_ALLOWED_MESSAGE });
  });

  assert.deepEqual(callsOutsideAllowedPaths(calls), []);
});

test('an array project id is refused instead of skipping the check', async () => {
  const calls: GitCall[] = [];

  await withGitServer(calls, async (baseUrl) => {
    const init = await postJson(`${baseUrl}/api/git/init`, { project: ['outside'] });
    assert.equal(init.status, 400);

    const status = await fetch(`${baseUrl}/api/git/status?project%5B%5D=outside`);
    assert.equal(status.status, 400);
  });

  assert.deepEqual(calls, []);
});

test('a repository whose root or git directory is outside ALLOWED_PATHS is refused', async () => {
  const calls: GitCall[] = [];

  await withGitServer(calls, async (baseUrl) => {
    // The project folder itself is allowed, so the Git panel names the
    // repository instead of saying the project is outside ALLOWED_PATHS.
    const status = await fetch(`${baseUrl}/api/git/status?project=mono`);
    assert.equal(status.status, 403);
    assert.deepEqual(await status.json(), { error: GIT_REPOSITORY_NOT_ALLOWED_MESSAGE });

    const discard = await postJson(`${baseUrl}/api/git/discard`, { project: 'mono', file: 'secrets.env' });
    assert.equal(discard.status, 403);
    assert.deepEqual(await discard.json(), { error: GIT_REPOSITORY_NOT_ALLOWED_MESSAGE });

    const linkedStatus = await fetch(`${baseUrl}/api/git/status?project=linked`);
    assert.equal(linkedStatus.status, 403);
    assert.deepEqual(await linkedStatus.json(), { error: GIT_REPOSITORY_NOT_ALLOWED_MESSAGE });
  });

  // Only the repository lookups ran; no status, diff or restore.
  assert.deepEqual(
    calls.filter(({ args }) => args[0] !== 'rev-parse'),
    [],
  );
});

test('a working-tree file reached through a symlink is neither read nor deleted outside ALLOWED_PATHS', async () => {
  const calls: GitCall[] = [];
  const prompts: string[] = [];

  await withGitServer(calls, async (baseUrl) => {
    const diff = await fetch(`${baseUrl}/api/git/diff?project=inside&file=escape/secret.txt`);
    assert.equal(diff.status, 403);
    assert.doesNotMatch(await diff.text(), new RegExp(SECRET));

    const fileWithDiff = await fetch(`${baseUrl}/api/git/file-with-diff?project=inside&file=escape/secret.txt`);
    assert.equal(fileWithDiff.status, 403);
    assert.doesNotMatch(await fileWithDiff.text(), new RegExp(SECRET));

    const branchDiff = await fetch(`${baseUrl}/api/git/branch-diff/file?project=inside&base=main&file=secretlink.txt`);
    assert.equal(branchDiff.status, 403);
    assert.doesNotMatch(await branchDiff.text(), new RegExp(SECRET));

    for (const route of ['discard', 'delete-untracked']) {
      const response = await postJson(`${baseUrl}/api/git/${route}`, { project: 'inside', file: 'escape/secret.txt' });
      assert.equal(response.status, 403, route);
    }

    const commitMessage = await postJson(`${baseUrl}/api/git/generate-commit-message`, {
      project: 'inside',
      files: ['escape/secret.txt'],
    });
    assert.equal(commitMessage.status, 200);
  }, prompts);

  assert.equal(prompts.length, 1);
  assert.doesNotMatch(prompts[0], new RegExp(SECRET));
  assert.equal(await fsPromises.readFile(secretFilePath, 'utf8'), SECRET);
});

test('an untracked file inside ALLOWED_PATHS is still read for diffs and commit messages', async () => {
  const calls: GitCall[] = [];
  const prompts: string[] = [];

  await withGitServer(calls, async (baseUrl) => {
    const branchDiff = await fetch(`${baseUrl}/api/git/branch-diff/file?project=inside&base=main&file=notes.txt`);
    assert.equal(branchDiff.status, 200);
    assert.match((await branchDiff.json() as { diff: string }).diff, /\+hello inside/);

    const fileWithDiff = await fetch(`${baseUrl}/api/git/file-with-diff?project=inside&file=notes.txt`);
    assert.equal(fileWithDiff.status, 200);
    assert.equal((await fileWithDiff.json() as { currentContent: string }).currentContent, 'hello inside');

    const commitMessage = await postJson(`${baseUrl}/api/git/generate-commit-message`, {
      project: 'inside',
      files: ['notes.txt'],
    });
    assert.equal(commitMessage.status, 200);
  }, prompts);

  assert.match(prompts[0] ?? '', /hello inside/);
});
