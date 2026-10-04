import assert from 'node:assert/strict';
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import path from 'node:path';
import test, { after } from 'node:test';
import { fileURLToPath } from 'node:url';

// Both variables are read when the utils module is first evaluated. The
// fixture lives beside this file because the temp directory is refused as a
// workspace location.
const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const fixtureRoot = await realpath(await mkdtemp(path.join(testDirectory, 'allowed-paths-root-fixture-')));
const workspacesRoot = path.join(fixtureRoot, 'root');
const allowedInsideRoot = path.join(workspacesRoot, 'proj1');
const allowedOutsideRoot = path.join(fixtureRoot, 'elsewhere');
await mkdir(allowedInsideRoot, { recursive: true });
await mkdir(path.join(workspacesRoot, 'proj2'), { recursive: true });
await mkdir(allowedOutsideRoot, { recursive: true });

const previousEnvironment = {
  WORKSPACES_ROOT: process.env.WORKSPACES_ROOT,
  ALLOWED_PATHS: process.env.ALLOWED_PATHS,
};
process.env.WORKSPACES_ROOT = workspacesRoot;
process.env.ALLOWED_PATHS = `${allowedInsideRoot},${allowedOutsideRoot}`;

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

test('an explicit WORKSPACES_ROOT and ALLOWED_PATHS must both contain a workspace', async () => {
  assert.equal((await validateWorkspacePath(path.join(allowedInsideRoot, 'app'))).valid, true);

  // Inside the root but not allowed.
  const notAllowed = await validateWorkspacePath(path.join(workspacesRoot, 'proj2'));
  assert.equal(notAllowed.valid, false);
  assert.equal(notAllowed.errorCode, 'PATH_NOT_ALLOWED');

  // Allowed but outside the explicitly configured root.
  const outsideRoot = await validateWorkspacePath(path.join(allowedOutsideRoot, 'app'));
  assert.equal(outsideRoot.valid, false);
  assert.equal(outsideRoot.errorCode, undefined);
  assert.match(outsideRoot.error ?? '', /allowed workspace root/);
});
