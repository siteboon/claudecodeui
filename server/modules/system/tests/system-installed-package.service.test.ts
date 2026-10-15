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
  /** package.json `dependencies`; defaults to the written native modules. */
  dependencies?: Record<string, string>;
};

// Node's own wording for a binding built for another Node (ERR_DLOPEN_FAILED),
// wrapped over several lines exactly as Node prints it.
const WRONG_ABI_MESSAGE = [
  "The module '/usr/lib/node_modules/@cloudcli-ai/cloudcli/node_modules/better-sqlite3/build/Release/better_sqlite3.node'",
  'was compiled against a different Node.js version using',
  'NODE_MODULE_VERSION 127. This version of Node.js requires',
  'NODE_MODULE_VERSION 137. Please try re-compiling or re-installing',
  'the module (for instance, using `npm rebuild` or `npm install`).',
].join('\n');

// Lays out a miniature global install: package.json with a cloudcli bin, the
// CLI entry, and node_modules for the two native dependencies.
function createInstallFixture(t: test.TestContext, options: FixtureOptions = {}): string {
  const appRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cloudcli-installed-package-'));
  t.after(() => fs.rmSync(appRoot, { recursive: true, force: true }));
  const version = options.version ?? '1.37.5';
  const nativeModules = options.nativeModules ?? {
    'better-sqlite3': 'module.exports = class Database { close() {} };',
    'node-pty': 'module.exports = {};',
  };
  fs.writeFileSync(path.join(appRoot, 'package.json'), JSON.stringify({
    name: '@cloudcli-ai/cloudcli',
    version,
    bin: { cloudcli: 'dist-server/server/modules/cli/cli.js' },
    dependencies: options.dependencies
      ?? Object.fromEntries(Object.keys(nativeModules).map((moduleName) => [moduleName, '*'])),
  }));
  fs.mkdirSync(path.join(appRoot, 'dist-server', 'server', 'modules', 'cli'), { recursive: true });
  fs.writeFileSync(
    path.join(appRoot, 'dist-server', 'server', 'modules', 'cli', 'cli.js'),
    options.cliSource ?? `console.log(${JSON.stringify(version)});\n`,
  );

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

test('a better-sqlite3 built for another Node fails the check and keeps Node\'s explanation (#1075)', async (t) => {
  const appRoot = createInstallFixture(t, {
    nativeModules: {
      'better-sqlite3': `module.exports = class Database {
        constructor() { throw new Error(${JSON.stringify(WRONG_ABI_MESSAGE)}); }
      };`,
      'node-pty': 'module.exports = {};',
    },
  });

  const result = await checkInstalledPackage(appRoot, CHECK_OPTIONS);

  assert.ok(!result.passed);
  assert.equal(
    result.reason,
    "better-sqlite3: The module '/usr/lib/node_modules/@cloudcli-ai/cloudcli/node_modules/better-sqlite3/build/Release/"
      + "better_sqlite3.node' was compiled against a different Node.js version using NODE_MODULE_VERSION 127. "
      + 'This version of Node.js requires NODE_MODULE_VERSION 137. Please try re-compiling or re-installing '
      + 'the module (for instance, using `npm rebuild` or `npm install`).',
  );
});

test('a node-pty without its binding fails the check without the require stack', async (t) => {
  const appRoot = createInstallFixture(t, {
    nativeModules: {
      'better-sqlite3': 'module.exports = class Database { close() {} };',
      // Node's MODULE_NOT_FOUND wording, as node-pty throws it when build/Release is gone.
      'node-pty': `throw new Error("Cannot find module '../build/Release/pty.node'\\nRequire stack:\\n- /app/node_modules/node-pty/lib/utils.js");`,
    },
  });

  const result = await checkInstalledPackage(appRoot, CHECK_OPTIONS);

  assert.ok(!result.passed);
  assert.equal(result.reason, "node-pty: Cannot find module '../build/Release/pty.node'");
});

test('a release that no longer depends on a checked native module is not held to it', async (t) => {
  // Neither module is installed: a later release that moved to node:sqlite and
  // a node-pty fork must still pass, as long as its CLI answers.
  const appRoot = createInstallFixture(t, {
    nativeModules: {},
    dependencies: { '@lydell/node-pty': '*', express: '*' },
  });

  assert.deepEqual(await checkInstalledPackage(appRoot, CHECK_OPTIONS), { passed: true });
});

test('a native module listed only as optional is not required to load', async (t) => {
  const appRoot = createInstallFixture(t, {
    nativeModules: { 'better-sqlite3': 'module.exports = class Database { close() {} };' },
  });
  const packageJsonPath = path.join(appRoot, 'package.json');
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  // npm may skip an optional dependency that fails to build, so its absence is not a broken install.
  fs.writeFileSync(packageJsonPath, JSON.stringify({ ...packageJson, optionalDependencies: { 'node-pty': '*' } }));

  assert.deepEqual(await checkInstalledPackage(appRoot, CHECK_OPTIONS), { passed: true });
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

test('a CLI that prints its version but exits non-zero fails the check', async (t) => {
  const appRoot = createInstallFixture(t, {
    version: '1.37.5',
    cliSource: `console.log('1.37.5');
      console.error('TypeError: Cannot read properties of undefined (reading \\'close\\')');
      process.exitCode = 1;\n`,
  });

  const result = await checkInstalledPackage(appRoot, CHECK_OPTIONS);

  assert.ok(!result.passed);
  assert.equal(
    result.reason,
    '"cloudcli version" failed: TypeError: Cannot read properties of undefined (reading \'close\')',
  );
});

test('a CLI that crashes keeps the error paragraph and drops the stack', async (t) => {
  // Node's report of an uncaught error: source excerpt, message, stack, extra properties.
  const uncaughtErrorReport = [
    '/app/node_modules/bindings/bindings.js:121',
    '        throw e;',
    '        ^',
    '',
    `Error: ${WRONG_ABI_MESSAGE}`,
    '    at Module._extensions..node (node:internal/modules/cjs/loader:1921:18)',
    '    at Module.load (node:internal/modules/cjs/loader:1465:32) {',
    "  code: 'ERR_DLOPEN_FAILED'",
    '}',
    '',
    'Node.js v24.21.0',
  ].join('\n');
  const appRoot = createInstallFixture(t, {
    cliSource: `process.stderr.write(${JSON.stringify(uncaughtErrorReport)});\nprocess.exitCode = 1;\n`,
  });

  const result = await checkInstalledPackage(appRoot, CHECK_OPTIONS);

  assert.ok(!result.passed);
  assert.match(result.reason, /^"cloudcli version" failed: Error: The module '\/usr\/lib\/.*better_sqlite3\.node' was compiled/);
  assert.match(result.reason, /requires NODE_MODULE_VERSION 137\. Please try re-compiling or re-installing the module/);
  assert.doesNotMatch(result.reason, /Module\._extensions|ERR_DLOPEN_FAILED|Node\.js v24/);
});

test('a CLI that throws reports the error, not the quoted source line', async (t) => {
  // Node quotes the throwing line, with a caret, before the error itself.
  const uncaughtErrorReport = [
    '/app/dist-server/server/load-env.js:3',
    "    throw new Error('Cannot read the config file');",
    '    ^',
    '',
    'Error: Cannot read the config file',
    '    at Object.<anonymous> (/app/dist-server/server/load-env.js:3:11)',
    '',
    'Node.js v24.21.0',
  ].join('\n');
  const appRoot = createInstallFixture(t, {
    cliSource: `process.stderr.write(${JSON.stringify(uncaughtErrorReport)});\nprocess.exitCode = 1;\n`,
  });

  const result = await checkInstalledPackage(appRoot, CHECK_OPTIONS);

  assert.ok(!result.passed);
  assert.equal(result.reason, '"cloudcli version" failed: Error: Cannot read the config file');
});

test('a CLI that prints a wall of text gives a capped reason', async (t) => {
  const wallOfText = Array.from({ length: 40 }, (_, index) => `Error line ${index + 1} ${'x'.repeat(60)}`).join('\n');
  const appRoot = createInstallFixture(t, {
    cliSource: `process.stderr.write(${JSON.stringify(wallOfText)});\nprocess.exitCode = 1;\n`,
  });

  const result = await checkInstalledPackage(appRoot, CHECK_OPTIONS);

  assert.ok(!result.passed);
  assert.match(result.reason, /^"cloudcli version" failed: Error line 1 x+ Error line 2 /);
  assert.match(result.reason, /…$/);
  assert.doesNotMatch(result.reason, /Error line 7 /);
  assert.ok(result.reason.length <= '"cloudcli version" failed: '.length + 600, String(result.reason.length));
});

test('a CLI that labels its version passes the check', async (t) => {
  for (const printedVersion of ['cloudcli 1.37.5', 'CloudCLI v1.37.5.', '@cloudcli-ai/cloudcli@1.37.5']) {
    const appRoot = createInstallFixture(t, {
      version: '1.37.5',
      cliSource: `console.log(${JSON.stringify(printedVersion)});\n`,
    });

    assert.deepEqual(await checkInstalledPackage(appRoot, CHECK_OPTIONS), { passed: true }, printedVersion);
  }
});

test('a CLI that reports another version than the one on disk fails the check', async (t) => {
  for (const printedVersion of ['1.37.4', '1.37.50', '1.37.5-beta.1', 'cloudcli 1.37.5.1', 'cloudcli 11.37.5']) {
    const appRoot = createInstallFixture(t, {
      version: '1.37.5',
      cliSource: `console.log(${JSON.stringify(printedVersion)});\n`,
    });

    const result = await checkInstalledPackage(appRoot, CHECK_OPTIONS);

    assert.ok(!result.passed, printedVersion);
    assert.equal(result.reason, `"cloudcli version" printed "${printedVersion}" instead of 1.37.5`);
  }
});

test('a CLI that never answers fails the check and says it timed out', async (t) => {
  const appRoot = createInstallFixture(t, {
    nativeModules: {},
    cliSource: 'setTimeout(() => undefined, 60_000);\n',
  });

  const result = await checkInstalledPackage(appRoot, { ...CHECK_OPTIONS, timeoutMilliseconds: 2_000 });

  assert.ok(!result.passed);
  assert.equal(result.reason, '"cloudcli version" did not answer within 2 s');
});

test('an install without a readable package.json fails the check', async (t) => {
  const appRoot = createInstallFixture(t);
  fs.writeFileSync(path.join(appRoot, 'package.json'), '{ truncated');

  const result = await checkInstalledPackage(appRoot, CHECK_OPTIONS);

  assert.ok(!result.passed);
  assert.equal(result.reason, 'the installed package.json could not be read');
});
