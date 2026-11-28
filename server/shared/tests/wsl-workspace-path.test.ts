import assert from 'node:assert/strict';
import { mkdir, mkdtemp, realpath, rm, symlink } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { resolveWorkspacePathForHost, validateWorkspacePath } from '@/shared/utils.js';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));

test('maps mounted Windows drives and current-distro WSL UNC paths on Linux/WSL', () => {
  const wsl2Mounts = [
    'C:\\134 /mnt/c 9p rw,noatime,aname=drvfs;path=C:\\;uid=1000 0 0',
    'F:\\134 /mnt/f 9p rw,noatime,aname=drvfs;path=F:\\;uid=1000 0 0',
    'F:\\134Work\\040Space /mnt/work 9p rw,noatime,aname=drvfs;path=F:\\Work\\040Space;uid=1000 0 0',
  ].join('\n');
  const wsl1Mounts = 'F: /mnt/f drvfs rw,noatime,uid=1000 0 0\n';

  assert.deepEqual(
    resolveWorkspacePathForHost('F:\\Workspaces\\demo-app', { platform: 'linux', mountsContent: wsl2Mounts }),
    { path: '/mnt/f/Workspaces/demo-app', isWindowsPath: true },
  );
  assert.deepEqual(
    resolveWorkspacePathForHost('f:/Workspaces/demo-app/', { platform: 'linux', mountsContent: wsl2Mounts }),
    { path: '/mnt/f/Workspaces/demo-app', isWindowsPath: true },
  );
  assert.deepEqual(
    resolveWorkspacePathForHost('\\\\?\\F:\\Workspaces\\demo-app', { platform: 'linux', mountsContent: wsl2Mounts }),
    { path: '/mnt/f/Workspaces/demo-app', isWindowsPath: true },
  );
  assert.deepEqual(
    resolveWorkspacePathForHost('F:\\Work Space\\repo', { platform: 'linux', mountsContent: wsl2Mounts }),
    { path: '/mnt/work/repo', isWindowsPath: true },
  );
  assert.deepEqual(
    resolveWorkspacePathForHost('F:\\Workspaces\\demo-app', { platform: 'linux', mountsContent: wsl1Mounts }),
    { path: '/mnt/f/Workspaces/demo-app', isWindowsPath: true },
  );
  assert.deepEqual(
    resolveWorkspacePathForHost('\\\\wsl.localhost\\Ubuntu-22.04\\home\\user\\app', {
      platform: 'linux',
      mountsContent: wsl2Mounts,
      wslDistroName: 'Ubuntu-22.04',
    }),
    { path: '/home/user/app', isWindowsPath: true },
  );
});

test('rejects unmounted drives, drive-relative paths, and non-WSL Windows paths instead of joining with cwd', async () => {
  const wslMounts = 'F:\\134 /mnt/f 9p rw,noatime,aname=drvfs;path=F:\\;uid=1000 0 0\n';

  for (const [label, target, mountsContent] of [
    ['unmounted drive', 'Z:\\Workspaces\\app', wslMounts],
    ['non-WSL Linux host', 'F:\\Workspaces\\app', ''],
    ['drive-relative path', 'F:relative\\app', wslMounts],
    ['bare drive letter', 'F:', wslMounts],
    ['other WSL distro UNC path', '\\\\wsl.localhost\\Debian\\home\\user\\app', wslMounts],
    ['network UNC path', '\\\\server\\share\\app', wslMounts],
  ] as const) {
    const validation = await validateWorkspacePath(target, {
      platform: 'linux',
      mountsContent,
      wslDistroName: 'Ubuntu-22.04',
    });
    assert.equal(validation.valid, false, `${label} should be rejected`);
    assert.ok(
      validation.error && !validation.error.includes('allowed workspace root'),
      `${label} must not fall back to cwd resolution: ${validation.error}`,
    );
  }

  const winSystemValidation = await validateWorkspacePath('C:\\Windows\\System32', {
    platform: 'linux',
    mountsContent: 'C:\\134 /mnt/c 9p rw,noatime,aname=drvfs;path=C:\\;uid=1000 0 0\n',
  });
  assert.equal(winSystemValidation.valid, false);
  assert.match(winSystemValidation.error || '', /system directory/);
});

test('rejects mounted network UNC paths before generic drvfs mount matching', async () => {
  const mountedUnc = [
    '\\\\server\\share /mnt/share 9p rw,noatime,aname=drvfs;path=\\\\server\\share;uid=1000 0 0',
    '\\\\wsl.localhost\\Debian /mnt/debian 9p rw,noatime,aname=drvfs;path=\\\\wsl.localhost\\Debian;uid=1000 0 0',
  ].join('\n');

  for (const target of [
    '\\\\server\\share\\app',
    '\\\\?\\UNC\\server\\share\\app',
    '\\\\wsl.localhost\\Debian\\home\\user\\app',
  ]) {
    const hostResolution = resolveWorkspacePathForHost(target, {
      platform: 'linux',
      mountsContent: mountedUnc,
      wslDistroName: 'Ubuntu-22.04',
    });
    assert.ok(hostResolution.error, `${target} should fail UNC resolution`);

    const validation = await validateWorkspacePath(target, {
      platform: 'linux',
      mountsContent: mountedUnc,
      wslDistroName: 'Ubuntu-22.04',
    });
    assert.equal(validation.valid, false);
    assert.match(validation.error || '', /Unsupported UNC/);
  }

  assert.deepEqual(
    resolveWorkspacePathForHost('\\\\wsl.localhost\\Ubuntu-22.04\\home\\user\\app', {
      platform: 'linux',
      mountsContent: mountedUnc,
      wslDistroName: 'Ubuntu-22.04',
    }),
    { path: '/home/user/app', isWindowsPath: true },
  );
});

test('blocks POSIX paths inside mounts rooted under forbidden Windows system directories', async () => {
  const mountsContent = [
    'C:\\134Windows\\134Temp /home/alice/win-temp 9p rw,noatime,aname=drvfs;path=C:\\Windows\\Temp;uid=1000 0 0',
    'F:\\134Work\\040Space /mnt/work 9p rw,noatime,aname=drvfs;path=F:\\Work\\040Space;uid=1000 0 0',
  ].join('\n');

  for (const forbiddenMountTarget of ['/home/alice/win-temp', '/home/alice/win-temp/project']) {
    const validation = await validateWorkspacePath(forbiddenMountTarget, {
      platform: 'linux',
      mountsContent,
    });
    assert.equal(validation.valid, false, `${forbiddenMountTarget} should be rejected`);
    assert.match(validation.error || '', /system directory/);
  }

  // Ordinary user-directory mounts must remain unaffected by the Windows system check.
  const userMountCheck = await validateWorkspacePath('/mnt/work/project', {
    platform: 'linux',
    mountsContent,
  });
  assert.ok(
    !(userMountCheck.error || '').includes('system directory'),
    `ordinary mount should not trigger system directory rejection: ${userMountCheck.error}`,
  );
});

test('canonicalizes DrvFS casing and resolves ancestor symlinks when multiple trailing segments are missing', { skip: process.platform === 'win32' }, async () => {
  // Keep fixture outside /tmp because FORBIDDEN_WORKSPACE_PATHS blocks /tmp itself.
  const tempRoot = await realpath(await mkdtemp(path.join(testDirectory, 'wsl-drvfs-fallback-')));
  const mountRoot = path.join(tempRoot, 'mnt-f');
  const workspacesRoot = path.join(mountRoot, 'Workspaces');
  const outsideDir = path.join(tempRoot, 'outside');
  const previousWorkspacesRoot = process.env.WORKSPACES_ROOT;

  try {
    await mkdir(workspacesRoot, { recursive: true });
    await mkdir(outsideDir, { recursive: true });
    await symlink(outsideDir, path.join(workspacesRoot, 'escape'));

    process.env.WORKSPACES_ROOT = workspacesRoot;
    const utilsUrl = new URL('../utils.js', import.meta.url);
    utilsUrl.searchParams.set('case', 'drvfs-ancestor-fallback');
    const utilsModule = (await import(utilsUrl.href)) as typeof import('@/shared/utils.js');

    const mountsContent = `F:\\134 ${mountRoot} 9p rw,noatime,aname=drvfs;path=F:\\;uid=1000 0 0\n`;

    const spacedPath = path.posix.join(workspacesRoot, 'notes ');
    await mkdir(spacedPath);
    for (const nativePath of [spacedPath, path.posix.join(spacedPath, 'draft ')]) {
      assert.deepEqual(await utilsModule.validateWorkspacePath(nativePath, { platform: 'linux', mountsContent }), {
        valid: true,
        resolvedPath: nativePath,
      });
    }

    const wrongCaseMissingMulti = await utilsModule.validateWorkspacePath('F:\\workspaces\\new\\app', {
      platform: 'linux',
      mountsContent,
    });
    assert.deepEqual(wrongCaseMissingMulti, {
      valid: true,
      resolvedPath: path.posix.join(workspacesRoot, 'new', 'app'),
    });

    const exactCaseMissingMulti = await utilsModule.validateWorkspacePath('F:\\Workspaces\\New\\App', {
      platform: 'linux',
      mountsContent,
    });
    assert.deepEqual(exactCaseMissingMulti, {
      valid: true,
      resolvedPath: path.posix.join(workspacesRoot, 'New', 'App'),
    });

    const symlinkEscapeMissingMulti = await utilsModule.validateWorkspacePath('F:\\workspaces\\escape\\new\\app', {
      platform: 'linux',
      mountsContent,
    });
    assert.equal(symlinkEscapeMissingMulti.valid, false);
    assert.match(symlinkEscapeMissingMulti.error || '', /allowed workspace root/);
  } finally {
    if (previousWorkspacesRoot === undefined) {
      delete process.env.WORKSPACES_ROOT;
    } else {
      process.env.WORKSPACES_ROOT = previousWorkspacesRoot;
    }
    await rm(tempRoot, { recursive: true, force: true });
  }
});
