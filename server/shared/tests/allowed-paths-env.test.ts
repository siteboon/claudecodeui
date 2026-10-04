import assert from 'node:assert/strict';
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';
import { fileURLToPath } from 'node:url';

// ALLOWED_PATHS, WORKSPACES_ROOT and the home directory are read when the
// utils module is first evaluated, so they are set before that import. The
// fixture lives beside this file: workspaces under the temp directory are
// refused as system directories regardless of ALLOWED_PATHS.
const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const fixtureRoot = await realpath(await mkdtemp(path.join(testDirectory, 'allowed-paths-env-fixture-')));
const fixtureHome = path.join(fixtureRoot, 'home');
// Outside the home directory on purpose: with WORKSPACES_ROOT unset, the
// home-directory default must give way to ALLOWED_PATHS.
const allowedDirectory = path.join(fixtureRoot, 'srv', 'allowed');
const allowedHomeDirectory = path.join(fixtureHome, 'inside-home');
const outsideDirectory = path.join(fixtureRoot, 'srv', 'outside');
await mkdir(allowedDirectory, { recursive: true });
await mkdir(allowedHomeDirectory, { recursive: true });
await mkdir(outsideDirectory, { recursive: true });
await mkdir(path.join(fixtureRoot, 'srv', 'allowed10'), { recursive: true });
await writeFile(path.join(outsideDirectory, 'secret.txt'), 'secret', 'utf8');

const previousEnvironment = {
  HOME: process.env.HOME,
  USERPROFILE: process.env.USERPROFILE,
  WORKSPACES_ROOT: process.env.WORKSPACES_ROOT,
  ALLOWED_PATHS: process.env.ALLOWED_PATHS,
};
process.env.HOME = fixtureHome;
process.env.USERPROFILE = fixtureHome;
delete process.env.WORKSPACES_ROOT;
process.env.ALLOWED_PATHS = ` ${allowedDirectory}/ , ~/inside-home ,`;

const {
  ALLOWED_PATHS,
  AppError,
  assertPathAllowed,
  filterByAllowedPaths,
  resolveReadOnlyRootPath,
  validateWorkspacePath,
} = await import('@/shared/utils.js');

after(async () => {
  for (const [name, value] of Object.entries(previousEnvironment)) {
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }
  await rm(fixtureRoot, { recursive: true, force: true });
});

test('ALLOWED_PATHS is parsed once from the environment', () => {
  assert.deepEqual(ALLOWED_PATHS, [allowedDirectory, allowedHomeDirectory]);
});

test('without WORKSPACES_ROOT, an allowed directory outside the home directory is a valid workspace', async () => {
  const validation = await validateWorkspacePath(path.join(allowedDirectory, 'new-workspace'));

  assert.equal(validation.valid, true);
  assert.equal(validation.resolvedPath, path.join(allowedDirectory, 'new-workspace'));
  assert.equal((await validateWorkspacePath(path.join(allowedHomeDirectory, 'app'))).valid, true);
});

test('a workspace outside ALLOWED_PATHS is refused with PATH_NOT_ALLOWED, even inside the home directory', async () => {
  for (const candidatePath of [
    outsideDirectory,
    path.join(fixtureHome, 'other-project'),
    path.join(fixtureRoot, 'srv', 'allowed10'),
    `${allowedDirectory}/../outside`,
  ]) {
    const validation = await validateWorkspacePath(candidatePath);
    assert.equal(validation.valid, false, candidatePath);
    assert.equal(validation.errorCode, 'PATH_NOT_ALLOWED', candidatePath);
  }
});

test('a workspace reached through a symlink that leaves ALLOWED_PATHS is refused', async () => {
  const escapeLink = path.join(allowedDirectory, 'escape');
  await symlink(outsideDirectory, escapeLink);

  try {
    assert.equal((await validateWorkspacePath(escapeLink)).errorCode, 'PATH_NOT_ALLOWED');
    assert.equal((await validateWorkspacePath(path.join(escapeLink, 'nested'))).errorCode, 'PATH_NOT_ALLOWED');
  } finally {
    await rm(escapeLink, { force: true });
  }
});

test('the read-only roots are not readable outside ALLOWED_PATHS', async () => {
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'allowed-paths-read-only-'));

  try {
    const filePath = path.join(temporaryDirectory, 'agent.output');
    await writeFile(filePath, 'agent output', 'utf8');
    assert.equal(await resolveReadOnlyRootPath(filePath), null);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test('assertPathAllowed throws a 403 PATH_NOT_ALLOWED error only outside ALLOWED_PATHS', async () => {
  await assertPathAllowed(path.join(allowedDirectory, 'file.txt'));
  await assert.rejects(
    assertPathAllowed(path.join(outsideDirectory, 'secret.txt')),
    (error: unknown) => error instanceof AppError && error.statusCode === 403 && error.code === 'PATH_NOT_ALLOWED',
  );
});

test('filterByAllowedPaths drops items outside ALLOWED_PATHS and keeps items without a path', async () => {
  const rows = [
    { name: 'inside', projectPath: path.join(allowedDirectory, 'app') },
    { name: 'outside', projectPath: outsideDirectory },
    { name: 'no-path', projectPath: null },
    { name: 'home', projectPath: allowedHomeDirectory },
  ];

  const filteredRows = await filterByAllowedPaths(rows, (row) => row.projectPath);
  assert.deepEqual(filteredRows.map((row) => row.name), ['inside', 'no-path', 'home']);
});
