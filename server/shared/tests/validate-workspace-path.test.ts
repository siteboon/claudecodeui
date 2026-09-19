import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, realpath, rm, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { validateWorkspacePathWithin } from '@/shared/utils.js';

// The fixtures lean on the POSIX entries of FORBIDDEN_WORKSPACE_PATHS: `/tmp`
// stands in for `/root` as a listed directory a workspace root can live in
// (a non-root test runner cannot create anything under `/root`), `/var/tmp` is
// the exempt location that plays "elsewhere", and `/usr` is a listed directory
// every uid can traverse, so its rejection does not depend on who runs the test.
// On macOS `/tmp` resolves to `/private/tmp`, which is not listed, so the
// listed-parent case only exercises the exemption on Linux.
const posixOnly = { skip: process.platform === 'win32' && 'uses POSIX system directories' };

test('a workspace root inside a listed system directory accepts its own subtree', posixOnly, async () => {
  const listedParent = await mkdtemp(path.join('/tmp', 'workspace-path-'));
  try {
    // WORKSPACES_ROOT=/root/workspace, or the default os.homedir() of a root user.
    // Resolved, because the validator answers with real paths and /tmp is a
    // symlink to /private/tmp on macOS.
    await mkdir(path.join(listedParent, 'workspace'));
    const workspacesRoot = await realpath(path.join(listedParent, 'workspace'));

    // The folder browser starts at the root itself before any project exists.
    assert.deepEqual(await validateWorkspacePathWithin(workspacesRoot, workspacesRoot), {
      valid: true,
      resolvedPath: workspacesRoot,
    });
    assert.deepEqual(await validateWorkspacePathWithin(workspacesRoot, path.join(workspacesRoot, 'my-app')), {
      valid: true,
      resolvedPath: path.join(workspacesRoot, 'my-app'),
    });
  } finally {
    await rm(listedParent, { recursive: true, force: true });
  }
});

test('a listed system directory outside the workspace root is still rejected as one', posixOnly, async () => {
  const workspacesRoot = await mkdtemp(path.join('/var/tmp', 'workspace-path-'));
  try {
    assert.deepEqual(await validateWorkspacePathWithin(workspacesRoot, '/usr/cloudcli-does-not-exist'), {
      valid: false,
      error: 'Cannot create workspace in system directory: /usr',
    });
    assert.deepEqual(await validateWorkspacePathWithin(workspacesRoot, '/usr'), {
      valid: false,
      error: 'Cannot use system-critical directories as workspace locations',
    });
    // A listed directory the process cannot even look into is still named as
    // one, not reported as a permission error — however deep the request goes.
    if (process.getuid?.() !== 0) {
      for (const requestedPath of ['/root/cloudcli-does-not-exist', '/root/cloudcli-does-not-exist/either']) {
        assert.deepEqual(await validateWorkspacePathWithin(workspacesRoot, requestedPath), {
          valid: false,
          error: 'Cannot create workspace in system directory: /root',
        });
      }
    }
    // /var/tmp stays exempt: a sibling there is outside the root, not a system directory.
    assert.deepEqual(await validateWorkspacePathWithin(workspacesRoot, `${workspacesRoot}-sibling`), {
      valid: false,
      error: `Workspace path must be within the allowed workspace root: ${workspacesRoot}`,
    });
  } finally {
    await rm(workspacesRoot, { recursive: true, force: true });
  }
});

test('a symlink outside the root is judged by where it resolves, not by its spelling', posixOnly, async () => {
  const exemptParent = await mkdtemp(path.join('/var/tmp', 'workspace-path-'));
  try {
    const workspacesRoot = path.join(exemptParent, 'workspace');
    const outsideDirectory = path.join(exemptParent, 'outside');
    await mkdir(workspacesRoot);
    await mkdir(outsideDirectory);
    const systemLink = path.join(outsideDirectory, 'system-link');
    await symlink('/usr', systemLink, 'dir');
    const escapeLink = path.join(workspacesRoot, 'escape');
    await symlink(outsideDirectory, escapeLink, 'dir');

    // Spelled under the exempt /var/tmp, but it resolves into /usr — and the
    // verdict does not depend on how many segments below the link are still
    // to be created, which is what a `mkdir -p` consumer would then do.
    for (const requestedPath of [
      path.join(systemLink, 'cloudcli-does-not-exist'),
      path.join(systemLink, 'cloudcli-does-not-exist', 'nested'),
    ]) {
      assert.deepEqual(await validateWorkspacePathWithin(workspacesRoot, requestedPath), {
        valid: false,
        error: 'Cannot create workspace in system directory: /usr',
      });
    }
    // Spelled inside the root, but a link leads out of it.
    for (const requestedPath of [path.join(escapeLink, 'a'), path.join(escapeLink, 'a', 'b')]) {
      assert.deepEqual(await validateWorkspacePathWithin(workspacesRoot, requestedPath), {
        valid: false,
        error: `Workspace path must be within the allowed workspace root: ${workspacesRoot}`,
      });
    }
  } finally {
    await rm(exemptParent, { recursive: true, force: true });
  }
});

test('a workspace root that is itself a symlink accepts a nested path that does not exist yet', posixOnly, async () => {
  const exemptParent = await mkdtemp(path.join('/var/tmp', 'workspace-path-'));
  try {
    const realWorkspacesRoot = path.join(exemptParent, 'workspace');
    const workspacesRoot = path.join(exemptParent, 'workspace-link');
    await mkdir(realWorkspacesRoot);
    await symlink(realWorkspacesRoot, workspacesRoot, 'dir');

    // Answered with the real path, the way an existing entry would be.
    assert.deepEqual(await validateWorkspacePathWithin(workspacesRoot, path.join(workspacesRoot, 'a', 'b')), {
      valid: true,
      resolvedPath: path.join(realWorkspacesRoot, 'a', 'b'),
    });
  } finally {
    await rm(exemptParent, { recursive: true, force: true });
  }
});

test('a dangling symlink is refused rather than treated as a path to create', posixOnly, async () => {
  const workspacesRoot = await mkdtemp(path.join('/var/tmp', 'workspace-path-'));
  try {
    const danglingLink = path.join(workspacesRoot, 'dangling');
    await symlink(path.join(workspacesRoot, 'gone'), danglingLink, 'dir');

    const result = await validateWorkspacePathWithin(workspacesRoot, path.join(danglingLink, 'project'));
    assert.equal(result.valid, false);
    assert.match(result.error ?? '', /^Path validation failed: Symbolic link target does not exist/);
  } finally {
    await rm(workspacesRoot, { recursive: true, force: true });
  }
});

test('a path inside the root the process cannot reach fails validation instead of the mkdir after it', posixOnly, async () => {
  const workspacesRoot = await mkdtemp(path.join('/var/tmp', 'workspace-path-'));
  const lockedDirectory = path.join(workspacesRoot, 'locked');
  try {
    await mkdir(lockedDirectory);
    await chmod(lockedDirectory, 0o000);

    if (process.getuid?.() !== 0) {
      const result = await validateWorkspacePathWithin(workspacesRoot, path.join(lockedDirectory, 'project'));
      assert.equal(result.valid, false);
      assert.match(result.error ?? '', /^Path validation failed: EACCES/);
    }
  } finally {
    await chmod(lockedDirectory, 0o755);
    await rm(workspacesRoot, { recursive: true, force: true });
  }
});

test('only the listed directories the workspace root lives in are exempt, not the ones under it', posixOnly, async () => {
  // WORKSPACES_ROOT=/ opts into nothing: `/usr` is under the root, not above it.
  assert.deepEqual(await validateWorkspacePathWithin('/', '/usr/cloudcli-does-not-exist'), {
    valid: false,
    error: 'Cannot create workspace in system directory: /usr',
  });
  assert.deepEqual(await validateWorkspacePathWithin('/', '/'), {
    valid: false,
    error: 'Cannot use system-critical directories as workspace locations',
  });
  // Containment still holds against a root spelled with its trailing separator.
  const homeProject = path.join(os.homedir(), 'cloudcli-does-not-exist');
  assert.deepEqual(await validateWorkspacePathWithin('/', homeProject), {
    valid: true,
    resolvedPath: path.join(await realpath(os.homedir()), 'cloudcli-does-not-exist'),
  });
});
