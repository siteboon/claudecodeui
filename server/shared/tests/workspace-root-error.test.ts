import assert from 'node:assert/strict';
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import path from 'node:path';
import test, { after } from 'node:test';
import { fileURLToPath } from 'node:url';

// `WORKSPACES_ROOT` is read when the utils module is first imported, so the
// fixture home has to be in place, and any inherited `WORKSPACES_ROOT`
// removed, before that import runs. The fixture lives beside this file rather
// than under the temp directory: the temp directory is a forbidden workspace
// location, which would be refused before the root check is reached.
const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const fixtureRoot = await realpath(await mkdtemp(path.join(testDirectory, 'workspace-root-fixture-')));
const fixtureHome = path.join(fixtureRoot, 'home');
const outsideDirectory = path.join(fixtureRoot, 'elsewhere');
await mkdir(path.join(fixtureHome, 'projects'), { recursive: true });
await mkdir(outsideDirectory);

const previousEnvironment = {
  HOME: process.env.HOME,
  USERPROFILE: process.env.USERPROFILE,
  WORKSPACES_ROOT: process.env.WORKSPACES_ROOT,
};
process.env.HOME = fixtureHome;
process.env.USERPROFILE = fixtureHome;
delete process.env.WORKSPACES_ROOT;

const { validateWorkspacePath } = await import('@/shared/utils.js');

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

test('a path outside the default workspace root is refused with the setting that moves the root', async () => {
  const validation = await validateWorkspacePath(path.join(outsideDirectory, 'new-project'));

  assert.equal(validation.valid, false);
  // The default root is the home directory. A Windows user who wanted a
  // project on another drive read this refusal as a fixed limit, because
  // nothing in it pointed at WORKSPACES_ROOT.
  assert.ok(
    validation.error?.startsWith(`Workspace path must be within the allowed workspace root: ${fixtureHome}. `),
    validation.error,
  );
  assert.match(validation.error ?? '', /set the WORKSPACES_ROOT environment variable and restart the server/);
});

test('a path inside the default workspace root is still accepted', async () => {
  const projectPath = path.join(fixtureHome, 'projects', 'app');

  assert.deepEqual(await validateWorkspacePath(projectPath), { valid: true, resolvedPath: projectPath });
});
