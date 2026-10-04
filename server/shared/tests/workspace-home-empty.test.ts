import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import test, { after } from 'node:test';

// With HOME set but empty, `os.homedir()` returns ''. The server user's home
// is exempt from FORBIDDEN_WORKSPACE_PATHS (#641); an empty home must exempt
// nothing rather than match every path. WORKSPACES_ROOT is set explicitly
// (here under the forbidden `/tmp`), since an empty HOME leaves the default
// root unusable anyway. Both are read once when the utils module is imported.
const isWindows = process.platform === 'win32';
const workspacesRoot = isWindows ? '' : await mkdtemp('/tmp/workspace-home-empty-');
const previousHome = process.env.HOME;
const previousWorkspacesRoot = process.env.WORKSPACES_ROOT;
if (!isWindows) {
  await mkdir(path.join(workspacesRoot, 'app'));
  process.env.HOME = '';
  process.env.WORKSPACES_ROOT = workspacesRoot;
}

const { validateWorkspacePath } = await import('@/shared/utils.js');

after(async () => {
  if (previousHome === undefined) {
    delete process.env.HOME;
  } else {
    process.env.HOME = previousHome;
  }
  if (previousWorkspacesRoot === undefined) {
    delete process.env.WORKSPACES_ROOT;
  } else {
    process.env.WORKSPACES_ROOT = previousWorkspacesRoot;
  }
  if (workspacesRoot) {
    await rm(workspacesRoot, { recursive: true, force: true });
  }
});

test('an empty home exempts nothing from the forbidden list', { skip: isWindows }, async () => {
  const validation = await validateWorkspacePath(path.join(workspacesRoot, 'app'));
  assert.equal(validation.valid, false);
  assert.equal(validation.error, 'Cannot create workspace in system directory: /tmp');
});
