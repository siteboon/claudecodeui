import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  createCodexProcessEnv,
  findUserCodexCli,
  resolveCodexCli,
} from '@/modules/providers/list/codex/codex-cli.js';

/**
 * Which Codex install CloudCLI runs. Each test builds the install layouts it
 * needs in a temp folder and passes a PATH of its own, so no Codex on this
 * machine is ever found or started.
 */

const POSIX_ONLY = { skip: process.platform === 'win32' ? 'POSIX install layouts and executable bits' : false };

const TARGETS: Record<string, { triple: string; platformPackage: string }> = {
  'linux-x64': { triple: 'x86_64-unknown-linux-musl', platformPackage: 'codex-linux-x64' },
  'linux-arm64': { triple: 'aarch64-unknown-linux-musl', platformPackage: 'codex-linux-arm64' },
  'darwin-x64': { triple: 'x86_64-apple-darwin', platformPackage: 'codex-darwin-x64' },
  'darwin-arm64': { triple: 'aarch64-apple-darwin', platformPackage: 'codex-darwin-arm64' },
};
const target = TARGETS[`${process.platform}-${process.arch}`];

const bundledPackageRoot = path.dirname(createRequire(import.meta.url).resolve('@openai/codex/package.json'));
const bundledVersion = (createRequire(import.meta.url)('@openai/codex/package.json') as { version: string }).version;

/** A stand-in native binary: prints `codex-cli <version>` for `--version`, or fails when version is null. */
async function writeFakeNative(filePath: string, version: string | null): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(
    filePath,
    version === null ? '#!/bin/sh\nexit 1\n' : `#!/bin/sh\necho "codex-cli ${version}"\n`,
    'utf8',
  );
  await chmod(filePath, 0o755);
}

async function withTempDir(run: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'codex-cli-test-'));
  try {
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('with no Codex on PATH, the bundled @openai/codex runs through its Node launcher', () => {
  const cli = resolveCodexCli({ PATH: '' });
  assert.ok(cli);
  assert.equal(cli.source, 'bundled');
  assert.equal(cli.command, process.execPath);
  assert.deepEqual(cli.commandArgs, [path.join(bundledPackageRoot, 'bin', 'codex.js')]);
  assert.equal(cli.probe.installed, true);
  assert.equal(cli.probe.version, bundledVersion);
  assert.equal(findUserCodexCli({ PATH: '' }), null);
});

test('the user\'s Codex wins unless the bundled one is newer', POSIX_ONLY, async () => {
  await withTempDir(async (dir) => {
    const binDir = path.join(dir, 'bin');
    const codexPath = path.join(binDir, 'codex');

    await writeFakeNative(codexPath, '9999.0.0');
    const newer = resolveCodexCli({ PATH: binDir });
    assert.equal(newer?.source, 'user');
    assert.equal(newer?.command, codexPath);
    assert.deepEqual(newer?.commandArgs, []);
    assert.equal(newer?.executablePath, codexPath);
    assert.equal(newer?.probe.version, '9999.0.0');

    // The same version: the user's, so CloudCLI matches the terminal.
    await writeFakeNative(codexPath, bundledVersion);
    assert.equal(resolveCodexCli({ PATH: binDir })?.source, 'user');

    // Older, or a version that cannot be read: the bundled one runs, while
    // the update still goes to the user's install.
    for (const version of ['0.0.1', null]) {
      await writeFakeNative(codexPath, version);
      assert.equal(resolveCodexCli({ PATH: binDir })?.source, 'bundled', `user version ${version}`);
      assert.equal(findUserCodexCli({ PATH: binDir })?.command, codexPath);
    }
  });
});

test('node_modules/.bin is skipped, so `npm run` cannot pass a dependency off as the user\'s Codex', POSIX_ONLY, async () => {
  await withTempDir(async (dir) => {
    const dependencyBin = path.join(dir, 'project', 'node_modules', '.bin');
    const userBin = path.join(dir, 'home', '.local', 'bin');
    await writeFakeNative(path.join(dependencyBin, 'codex'), '9999.0.0');

    assert.equal(findUserCodexCli({ PATH: dependencyBin }), null);
    assert.equal(resolveCodexCli({ PATH: dependencyBin })?.source, 'bundled');

    // The first match after it is the user's, as in a shell without npm's entries.
    await writeFakeNative(path.join(userBin, 'codex'), '9999.1.0');
    const cli = resolveCodexCli({ PATH: [dependencyBin, userBin].join(path.delimiter) });
    assert.equal(cli?.command, path.join(userBin, 'codex'));
    assert.equal(cli?.probe.version, '9999.1.0');
  });
});

test('a standalone install runs through its PATH link, with its release helpers on PATH', POSIX_ONLY, async () => {
  await withTempDir(async (dir) => {
    const release = path.join(dir, '.codex', 'packages', 'standalone', 'releases', '9999.0.0-test');
    const binDir = path.join(dir, '.local', 'bin');
    await writeFakeNative(path.join(release, 'bin', 'codex'), '9999.0.0');
    await mkdir(path.join(release, 'codex-path'), { recursive: true });
    await mkdir(binDir, { recursive: true });
    await symlink(path.join(release, 'bin', 'codex'), path.join(binDir, 'codex'));

    const cli = resolveCodexCli({ PATH: binDir });
    assert.equal(cli?.source, 'user');
    assert.equal(cli?.command, path.join(binDir, 'codex'));
    assert.equal(cli?.displayCommand, path.join(binDir, 'codex'));
    assert.deepEqual(cli?.pathDirs, [path.join(release, 'codex-path')]);

    const env = createCodexProcessEnv(cli!, { PATH: '/usr/bin', HOME: '/home/someone', UNSET: undefined });
    assert.equal(env.PATH, [path.join(release, 'codex-path'), '/usr/bin'].join(path.delimiter));
    assert.equal(env.HOME, '/home/someone');
    assert.equal('UNSET' in env, false);
  });
});

test('an npm install runs its launcher through Node and hands the SDK the native binary from its platform package', {
  skip: process.platform === 'win32' || !target ? 'POSIX npm layout on a supported platform' : false,
}, async () => {
  await withTempDir(async (dir) => {
    // npm's global layout: <prefix>/bin/codex -> ../lib/node_modules/@openai/codex/bin/codex.js
    const packageRoot = path.join(dir, 'lib', 'node_modules', '@openai', 'codex');
    const platformRoot = path.join(packageRoot, 'node_modules', '@openai', target!.platformPackage);
    const targetDir = path.join(platformRoot, 'vendor', target!.triple);
    await mkdir(path.join(packageRoot, 'bin'), { recursive: true });
    await writeFile(path.join(packageRoot, 'package.json'), JSON.stringify({ name: '@openai/codex', version: '9999.0.0' }));
    await writeFile(path.join(packageRoot, 'bin', 'codex.js'), '#!/usr/bin/env node\n');
    await chmod(path.join(packageRoot, 'bin', 'codex.js'), 0o755);
    await writeFakeNative(path.join(targetDir, 'bin', 'codex'), '9999.0.0');
    await writeFile(path.join(platformRoot, 'package.json'), JSON.stringify({ name: `@openai/${target!.platformPackage}` }));
    await mkdir(path.join(targetDir, 'codex-path'), { recursive: true });
    await mkdir(path.join(dir, 'bin'), { recursive: true });
    await symlink(path.join('..', 'lib', 'node_modules', '@openai', 'codex', 'bin', 'codex.js'), path.join(dir, 'bin', 'codex'));

    const cli = resolveCodexCli({ PATH: path.join(dir, 'bin') });
    assert.equal(cli?.source, 'user');
    assert.equal(cli?.command, process.execPath);
    assert.deepEqual(cli?.commandArgs, [path.join(packageRoot, 'bin', 'codex.js')]);
    assert.equal(cli?.displayCommand, path.join(dir, 'bin', 'codex'));
    assert.equal(cli?.executablePath, path.join(targetDir, 'bin', 'codex'));
    assert.deepEqual(cli?.pathDirs, [path.join(targetDir, 'codex-path')]);
    assert.equal(cli?.probe.version, '9999.0.0');

    // Without its native binary the package cannot run, so it does not count as an install.
    await rm(path.join(targetDir, 'bin', 'codex'));
    assert.equal(findUserCodexCli({ PATH: path.join(dir, 'bin') }), null);
    assert.equal(resolveCodexCli({ PATH: path.join(dir, 'bin') })?.source, 'bundled');
  });
});
