import assert from 'node:assert/strict';
import test, { after } from 'node:test';

// Some service accounts have `/` as their home. The server user's home is
// exempt from FORBIDDEN_WORKSPACE_PATHS (#641), but a home that is the
// filesystem root must not be, or it would switch the whole list off. HOME has
// to be set before the utils module is imported because it is read once at
// import time.
const isWindows = process.platform === 'win32';
const previousHome = process.env.HOME;
const previousWorkspacesRoot = process.env.WORKSPACES_ROOT;
if (!isWindows) {
  process.env.HOME = '/';
  delete process.env.WORKSPACES_ROOT;
}

const { validateWorkspacePath } = await import('@/shared/utils.js');

after(() => {
  if (previousHome === undefined) {
    delete process.env.HOME;
  } else {
    process.env.HOME = previousHome;
  }
  if (previousWorkspacesRoot !== undefined) {
    process.env.WORKSPACES_ROOT = previousWorkspacesRoot;
  }
});

test('a home that is the filesystem root does not exempt the system directories', { skip: isWindows }, async () => {
  for (const systemDirectory of ['/etc', '/root', '/usr']) {
    const validation = await validateWorkspacePath(systemDirectory);
    assert.equal(validation.valid, false, systemDirectory);
    assert.equal(validation.error, 'Cannot use system-critical directories as workspace locations', systemDirectory);
  }

  const nested = await validateWorkspacePath('/etc/app');
  assert.equal(nested.error, 'Cannot create workspace in system directory: /etc');

  // `/` is this home itself, so the exemption covers it; only the explicit
  // filesystem-root check keeps it out.
  const filesystemRoot = await validateWorkspacePath('/');
  assert.equal(filesystemRoot.valid, false);
  assert.equal(filesystemRoot.error, 'Cannot use system-critical directories as workspace locations');
});
