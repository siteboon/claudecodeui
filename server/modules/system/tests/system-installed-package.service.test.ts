import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { findApplicationRoot, getModuleDirectory } from '@/shared/utils.js';

import { checkInstalledPackage, readInstalledPackageVersion } from '../system-installed-package.service.js';

const REPOSITORY_ROOT = findApplicationRoot(getModuleDirectory(import.meta.url));
const CHECK_OPTIONS = {
  nodeExecutable: process.execPath,
  environment: process.env,
  timeoutMilliseconds: 30_000,
};

type FixtureOptions = {
  version?: string;
  cliSource?: string;
  /** Package directories to write, keyed by module name; `real` links the repository's own copy. */
  nativeModules?: Record<string, string | 'real'>;
};

// Lays out a miniature global install: package.json with a cloudcli bin, the
// CLI entry, and node_modules for the two native dependencies.
function createInstallFixture(t: test.TestContext, options: FixtureOptions = {}): string {
  const appRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cloudcli-installed-package-'));
  t.after(() => fs.rmSync(appRoot, { recursive: true, force: true }));
  const version = options.version ?? '1.37.5';
  fs.writeFileSync(path.join(appRoot, 'package.json'), JSON.stringify({
    name: '@cloudcli-ai/cloudcli',
    version,
    bin: { cloudcli: 'dist-server/server/modules/cli/cli.js' },
  }));
  fs.mkdirSync(path.join(appRoot, 'dist-server', 'server', 'modules', 'cli'), { recursive: true });
  fs.writeFileSync(
    path.join(appRoot, 'dist-server', 'server', 'modules', 'cli', 'cli.js'),
    options.cliSource ?? `console.log(${JSON.stringify(version)});\n`,
  );

  const nativeModules = options.nativeModules ?? {
    'better-sqlite3': 'module.exports = class Database { close() {} };',
    'node-pty': 'module.exports = {};',
  };
  for (const [moduleName, source] of Object.entries(nativeModules)) {
    const modulePath = path.join(appRoot, 'node_modules', moduleName);
    fs.mkdirSync(path.dirname(modulePath), { recursive: true });
    if (source === 'real') {
      fs.symlinkSync(path.join(REPOSITORY_ROOT, 'node_modules', moduleName), modulePath, 'junction');
      continue;
    }
    fs.mkdirSync(modulePath);
    fs.writeFileSync(path.join(modulePath, 'package.json'), JSON.stringify({ name: moduleName, main: 'index.js' }));
    fs.writeFileSync(path.join(modulePath, 'index.js'), source);
  }
  return appRoot;
}

test('reads the version an install put on disk, or null when there is no package.json', (t) => {
  const appRoot = createInstallFixture(t, { version: '1.37.5' });

  assert.equal(readInstalledPackageVersion(appRoot), '1.37.5');
  assert.equal(readInstalledPackageVersion(path.join(appRoot, 'missing')), null);
});

test('an install whose real native modules load and whose CLI answers its version passes', async (t) => {
  const appRoot = createInstallFixture(t, {
    nativeModules: { 'better-sqlite3': 'real', 'node-pty': 'real' },
  });

  assert.deepEqual(await checkInstalledPackage(appRoot, CHECK_OPTIONS), { passed: true });
});

test('a missing better-sqlite3 binding fails the check with the loader message (#1075)', async (t) => {
  const appRoot = createInstallFixture(t, {
    nativeModules: {
      // What better-sqlite3 throws when its build/Release binding is absent.
      'better-sqlite3': `module.exports = class Database {
        constructor() { throw new Error('Could not locate the bindings file. Tried:\\n → /app/build/better_sqlite3.node'); }
      };`,
      'node-pty': 'module.exports = {};',
    },
  });

  const result = await checkInstalledPackage(appRoot, CHECK_OPTIONS);

  assert.equal(result.passed, false);
  assert.ok(!result.passed);
  assert.equal(result.reason, 'better-sqlite3: Could not locate the bindings file.');
  assert.match(result.details, /→ \/app\/build\/better_sqlite3\.node/);
});

test('a node-pty built for another Node fails the check', async (t) => {
  const appRoot = createInstallFixture(t, {
    nativeModules: {
      'better-sqlite3': 'module.exports = class Database { close() {} };',
      'node-pty': `throw new Error('The module pty.node was compiled against a different Node.js version');`,
    },
  });

  const result = await checkInstalledPackage(appRoot, CHECK_OPTIONS);

  assert.ok(!result.passed);
  assert.equal(result.reason, 'node-pty: The module pty.node was compiled against a different Node.js version');
});

test('a CLI that cannot run fails the check after the native modules pass', async (t) => {
  const appRoot = createInstallFixture(t, {
    // load-env prints its notice first in every install that has no .env.
    cliSource: `console.error('No .env file found or error reading it: ENOENT');
      console.error('Error [ERR_MODULE_NOT_FOUND]: Cannot find module ./load-env.js');
      process.exit(1);\n`,
  });

  const result = await checkInstalledPackage(appRoot, CHECK_OPTIONS);

  assert.ok(!result.passed);
  assert.equal(result.reason, '"cloudcli version" failed: Error [ERR_MODULE_NOT_FOUND]: Cannot find module ./load-env.js');
});

test('a CLI that reports another version than the one on disk fails the check', async (t) => {
  const appRoot = createInstallFixture(t, {
    version: '1.37.5',
    cliSource: `console.log('1.37.4');\n`,
  });

  const result = await checkInstalledPackage(appRoot, CHECK_OPTIONS);

  assert.ok(!result.passed);
  assert.equal(result.reason, '"cloudcli version" printed "1.37.4" instead of 1.37.5');
});
