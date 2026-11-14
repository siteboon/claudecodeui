import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';

import { resolveCodexExecutablePath } from '@/shared/index.js';
import type { ResolveCodexExecutableDependencies } from '@/shared/types.js';

for (const arch of ['x64', 'arm64']) {
  for (const layout of ['global', 'local', 'legacy']) {
    test(`Windows Codex resolves the ${arch} ${layout} npm shim without a shell`, () => {
      const shim = layout === 'local' ? 'C:\\project\\node_modules\\.bin\\codex.cmd' : 'C:\\npm tools\\codex.cmd';
      const relativeLauncher = layout === 'local'
        ? '..\\@openai\\codex\\bin\\codex.js' : 'node_modules\\@openai\\codex\\bin\\codex.js';
      const launcher = path.win32.resolve(path.win32.dirname(shim), relativeLauncher);
      const packagePath = `C:\\selected install\\node_modules\\@openai\\codex-win32-${arch}\\package.json`;
      const vendor = layout === 'legacy'
        ? path.win32.resolve(path.win32.dirname(launcher), '..', 'vendor')
        : path.win32.join(path.win32.dirname(packagePath), 'vendor');
      const triple = arch === 'x64' ? 'x86_64-pc-windows-msvc' : 'aarch64-pc-windows-msvc';
      const native = path.win32.join(vendor, triple, 'bin', 'codex.exe');
      const environment = { Path: 'C:\\profile-only-path' };
      const dependencies: ResolveCodexExecutableDependencies = {
        platform: 'win32', arch,
        execFileSync: ((_command: string, args: string[], options: { env: unknown }) => {
          assert.deepEqual(args, ['codex']);
          assert.equal(options.env, environment);
          // A second installation's native binary must not outrank the first shim.
          return `${shim.slice(0, -4)}\r\n${shim}\r\nC:\\other-install\\codex.exe\r\n`;
        }) as unknown as ResolveCodexExecutableDependencies['execFileSync'],
        readFileSync: ((file: string) => {
          assert.equal(file, shim);
          return `@echo off\r\n"%dp0%\\node.exe" "%dp0%\\${relativeLauncher}" %*\r\n`;
        }) as unknown as ResolveCodexExecutableDependencies['readFileSync'],
        resolvePackage: (name, source) => {
          assert.equal(source, launcher);
          assert.equal(name, `@openai/codex-win32-${arch}/package.json`);
          if (layout === 'legacy') throw new Error('legacy vendor layout');
          return packagePath;
        },
        existsSync: (file) => file === native,
      };
      assert.equal(resolveCodexExecutablePath('codex', environment, dependencies), native);
      assert.equal(resolveCodexExecutablePath(shim, environment, {
        ...dependencies, execFileSync: (() => { throw new Error('explicit paths must not use PATH'); }) as unknown as ResolveCodexExecutableDependencies['execFileSync'],
      }), native);
    });
  }
}

test('Codex preserves POSIX paths, Windows native binaries and the bundled default', () => {
  assert.equal(resolveCodexExecutablePath('/profile/codex', {}, { platform: 'linux' }), '/profile/codex');
  assert.equal(resolveCodexExecutablePath('C:\\profile\\codex.exe', {}, { platform: 'win32' }), 'C:\\profile\\codex.exe');
  assert.equal(resolveCodexExecutablePath(undefined, {}, { platform: 'win32' }), undefined);
});

test('Codex rejects unrecognized or incomplete command shims instead of spawning a shell', () => {
  for (const content of ['@echo off\r\ncustom-program %*', '"%dp0%\\node_modules\\@openai\\codex\\bin\\codex.js" %*']) {
    assert.throws(() => resolveCodexExecutablePath('C:\\tools\\custom.cmd', {}, {
      platform: 'win32', arch: 'x64', existsSync: () => false,
      readFileSync: (() => content) as unknown as ResolveCodexExecutableDependencies['readFileSync'],
      resolvePackage: () => { throw new Error('missing package'); },
    }), /native codex\.exe path/);
  }
});
