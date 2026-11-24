import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveWorkspacePathForHost, validateWorkspacePath } from '@/shared/utils.js';

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
