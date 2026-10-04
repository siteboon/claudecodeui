import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, symlink } from 'node:fs/promises';
import path from 'node:path';
import test, { after } from 'node:test';

// A server started as root has HOME=/root, and `/root` is on
// FORBIDDEN_WORKSPACE_PATHS while the default WORKSPACES_ROOT is that same
// home (#641). Root is not available to the test, so the fixture home is put
// under another forbidden entry, `/tmp`, which is the same shape: a home that
// sits inside a "system" directory. HOME has to be set, and WORKSPACES_ROOT
// cleared, before the utils module is imported because both are read once
// at import time.
const isWindows = process.platform === 'win32';
const fixtureParent = isWindows ? '' : await mkdtemp('/tmp/workspace-home-exemption-');
const fixtureHome = path.join(fixtureParent, 'home');
// A directory beside the home, under the same forbidden `/tmp`.
const siblingDirectory = path.join(fixtureParent, 'not-home');

const previousHome = process.env.HOME;
const previousWorkspacesRoot = process.env.WORKSPACES_ROOT;
if (!isWindows) {
  await mkdir(path.join(fixtureHome, 'projects', 'existing-app'), { recursive: true });
  await mkdir(siblingDirectory);
  process.env.HOME = fixtureHome;
  delete process.env.WORKSPACES_ROOT;
}

const { WORKSPACES_ROOT, validateWorkspacePath } = await import('@/shared/utils.js');

after(async () => {
  if (previousHome === undefined) {
    delete process.env.HOME;
  } else {
    process.env.HOME = previousHome;
  }
  if (previousWorkspacesRoot !== undefined) {
    process.env.WORKSPACES_ROOT = previousWorkspacesRoot;
  }
  if (fixtureParent) {
    await rm(fixtureParent, { recursive: true, force: true });
  }
});

test('the default workspace root is the home, which lies under a forbidden directory', { skip: isWindows }, () => {
  assert.equal(WORKSPACES_ROOT, fixtureHome);
  assert.ok(fixtureHome.startsWith('/tmp/'));
});

test('the server home itself is a valid workspace, so the folder browser can list it', { skip: isWindows }, async () => {
  const validation = await validateWorkspacePath(fixtureHome);
  assert.equal(validation.error, undefined);
  assert.equal(validation.valid, true);
});

test('existing and new folders inside the server home are valid workspaces', { skip: isWindows }, async () => {
  const existing = await validateWorkspacePath(path.join(fixtureHome, 'projects', 'existing-app'));
  assert.equal(existing.valid, true, existing.error);

  // What "create folder" and "new project" validate before the directory exists.
  const missing = await validateWorkspacePath(path.join(fixtureHome, 'projects', 'new-app'));
  assert.equal(missing.valid, true, missing.error);
});

test('the forbidden list still applies outside the server home', { skip: isWindows }, async () => {
  const forbiddenParent = await validateWorkspacePath('/tmp');
  assert.equal(forbiddenParent.valid, false);
  assert.equal(forbiddenParent.error, 'Cannot use system-critical directories as workspace locations');

  const sibling = await validateWorkspacePath(siblingDirectory);
  assert.equal(sibling.valid, false);
  assert.equal(sibling.error, 'Cannot create workspace in system directory: /tmp');

  // `..` is resolved before the home check, so it cannot climb out of the home.
  const escaped = await validateWorkspacePath(`${fixtureHome}/../not-home`);
  assert.equal(escaped.valid, false);
  assert.equal(escaped.error, 'Cannot create workspace in system directory: /tmp');

  // The home exemption is not a way past the other system directories either.
  assert.equal((await validateWorkspacePath('/etc')).valid, false);
});

test('a link inside the server home to a system directory is still rejected', { skip: isWindows }, async () => {
  const linkPath = path.join(fixtureHome, 'etc-link');
  await symlink('/etc', linkPath);

  const validation = await validateWorkspacePath(linkPath);
  assert.equal(validation.valid, false);
});
