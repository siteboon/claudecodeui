import assert from 'node:assert/strict';
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';
import { fileURLToPath } from 'node:url';

// The Claude projects root is derived from `os.homedir()` when the utils module
// is first imported, so HOME has to point at the fixture home *before* that
// import runs. The fixture lives beside this file rather than under the temp
// directory: a home under `/tmp` would put everything under a read-only root
// and make the escape tests pass for the wrong reason.
const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const fixtureRoot = await realpath(await mkdtemp(path.join(testDirectory, 'read-only-roots-fixture-')));
const fixtureHome = path.join(fixtureRoot, 'home');
const claudeProjectsRoot = path.join(fixtureHome, '.claude', 'projects');
// Under no read-only root: not the temp directory, not the Claude projects dir.
const outsideDirectory = path.join(fixtureRoot, 'outside');
await mkdir(claudeProjectsRoot, { recursive: true });
await mkdir(outsideDirectory);

const previousHome = process.env.HOME;
const previousUserProfile = process.env.USERPROFILE;
process.env.HOME = fixtureHome;
process.env.USERPROFILE = fixtureHome;

const { resolvePathUnderRoots, resolveReadOnlyRootPath, validateWorkspacePath } = await import('@/shared/utils.js');

after(async () => {
  if (previousHome === undefined) {
    delete process.env.HOME;
  } else {
    process.env.HOME = previousHome;
  }
  if (previousUserProfile === undefined) {
    delete process.env.USERPROFILE;
  } else {
    process.env.USERPROFILE = previousUserProfile;
  }
  await rm(fixtureRoot, { recursive: true, force: true });
});

test('a path under the system temp directory resolves as readable', async () => {
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'read-only-root-'));

  try {
    const filePath = path.join(temporaryDirectory, 'agent.output');
    await writeFile(filePath, 'agent output', 'utf8');

    // A background command's log is quoted straight out of the transcript, so
    // this exact shape has to resolve.
    const resolvedDirectory = await resolveReadOnlyRootPath(temporaryDirectory);
    assert.ok(resolvedDirectory);
    assert.equal(await resolveReadOnlyRootPath(filePath), path.join(resolvedDirectory, 'agent.output'));
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test('a background agent output link resolves to its transcript under the Claude projects directory', async () => {
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'read-only-root-'));

  try {
    // Claude writes `/tmp/claude-<uid>/<project>/<session>/tasks/<task>.output`
    // as a symlink to the agent's transcript under `~/.claude/projects`.
    const transcriptDirectory = path.join(claudeProjectsRoot, '-home-user-project', 'session-1', 'subagents');
    await mkdir(transcriptDirectory, { recursive: true });
    const transcriptPath = path.join(transcriptDirectory, 'agent-1.jsonl');
    await writeFile(transcriptPath, '{"type":"assistant"}\n', 'utf8');

    const tasksDirectory = path.join(temporaryDirectory, 'tasks');
    await mkdir(tasksDirectory);
    const outputLink = path.join(tasksDirectory, 'task-1.output');
    await symlink(transcriptPath, outputLink);

    assert.equal(await resolveReadOnlyRootPath(outputLink), transcriptPath);
    assert.equal(await resolveReadOnlyRootPath(transcriptPath), transcriptPath);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test('the temp directory stays read-only: it is still not a valid workspace location', async () => {
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'read-only-root-'));

  try {
    // Being browsable must not make it writable — the write policy is
    // `validateWorkspacePath` and it does not consult the read-only roots.
    const validation = await validateWorkspacePath(temporaryDirectory);
    assert.equal(validation.valid, false);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test('paths outside the read-only roots do not resolve', async () => {
  assert.equal(await resolveReadOnlyRootPath(outsideDirectory), null);
  assert.equal(await resolveReadOnlyRootPath('/etc/passwd'), null);
  assert.equal(await resolveReadOnlyRootPath('relative/path'), null);
  assert.equal(await resolveReadOnlyRootPath(''), null);
});

test('a symlink planted in the temp directory cannot read outside every root', async () => {
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'read-only-root-'));

  try {
    await writeFile(path.join(outsideDirectory, 'secret.txt'), 'secret', 'utf8');
    const escapeLink = path.join(temporaryDirectory, 'escape');
    await symlink(outsideDirectory, escapeLink);

    // The name is under a read-only root but the file is not, so resolving the
    // link before comparing is what keeps this closed.
    assert.equal(await resolveReadOnlyRootPath(escapeLink), null);
    assert.equal(await resolveReadOnlyRootPath(path.join(escapeLink, 'secret.txt')), null);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test('a root that does not exist does not stop later roots from matching', async () => {
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'read-only-root-'));

  try {
    // `/tmp` does not exist on Windows; the temp directory listed after it
    // must still be checked rather than the whole search giving up.
    const missingRoot = path.join(fixtureRoot, 'missing');
    assert.equal(await resolvePathUnderRoots(temporaryDirectory, [missingRoot]), null);
    assert.equal(
      await resolvePathUnderRoots(temporaryDirectory, [missingRoot, os.tmpdir()]),
      await realpath(temporaryDirectory),
    );
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test('traversal out of the temp directory does not resolve', async () => {
  assert.equal(await resolveReadOnlyRootPath(`${os.tmpdir()}/../etc/passwd`), null);
});
