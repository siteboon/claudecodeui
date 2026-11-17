import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

// The deprecated @siteboon/claude-code-ui package (redirect-package/) only forwards to @cloudcli-ai/cloudcli.
// These tests install copies of it next to a fake @cloudcli-ai/cloudcli, the way npm lays packages out, and
// run its bin in a child process.

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const applicationRoot = path.resolve(testDirectory, '..', '..', '..', '..');
const redirectPackageDirectory = path.join(applicationRoot, 'redirect-package');
const CLI_OUTPUT_PREFIX = '__FAKE_CLOUDCLI_ARGS__';
// The fake CLI echoes its arguments so a test can tell it ran and received what the user typed.
const FAKE_CLI_SOURCE = `console.log(${JSON.stringify(CLI_OUTPUT_PREFIX)} + JSON.stringify(process.argv.slice(2)));\n`;
// A resolution failure should read as a short message, not as an uncaught error with a stack trace.
const STACK_FRAME_PATTERN = /^\s+at /m;

type FakeTargetPackage = {
  packageJson: Record<string, unknown>;
  files?: Record<string, string>;
};

type ShimRun = {
  status: number | null;
  stdout: string;
  stderr: string;
};

async function withFixture(run: (fixtureRoot: string) => Promise<void>): Promise<void> {
  const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), 'cloudcli-redirect-package-'));
  try {
    await run(fixtureRoot);
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
}

async function installShim(shimDirectory: string): Promise<void> {
  await mkdir(shimDirectory, { recursive: true });
  await Promise.all(['bin.js', 'index.js', 'package.json'].map((fileName) => copyFile(
    path.join(redirectPackageDirectory, fileName),
    path.join(shimDirectory, fileName),
  )));
}

async function installFakeTarget(packageDirectory: string, target: FakeTargetPackage): Promise<void> {
  await mkdir(packageDirectory, { recursive: true });
  await writeFile(
    path.join(packageDirectory, 'package.json'),
    JSON.stringify({ name: '@cloudcli-ai/cloudcli', version: '9.9.9', type: 'module', ...target.packageJson }),
    'utf8',
  );
  for (const [relativePath, source] of Object.entries(target.files ?? {})) {
    const filePath = path.join(packageDirectory, relativePath);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, source, 'utf8');
  }
}

/** Hoisted layout used by `npx` and local installs: both packages sit in the same node_modules folder. */
async function installHoisted(fixtureRoot: string, target: FakeTargetPackage | null): Promise<string> {
  const nodeModules = path.join(fixtureRoot, 'node_modules');
  const shimDirectory = path.join(nodeModules, '@siteboon', 'claude-code-ui');
  await installShim(shimDirectory);
  if (target) {
    await installFakeTarget(path.join(nodeModules, '@cloudcli-ai', 'cloudcli'), target);
  }
  return shimDirectory;
}

function runNode(argumentsList: string[], cwd: string): ShimRun {
  const childEnvironment = { ...process.env };
  delete childEnvironment.NODE_PATH;
  const result = spawnSync(process.execPath, argumentsList, {
    cwd,
    encoding: 'utf8',
    env: childEnvironment,
    timeout: 30_000,
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function runShimBin(shimDirectory: string, argumentsList: string[]): ShimRun {
  return runNode([path.join(shimDirectory, 'bin.js'), ...argumentsList], path.dirname(shimDirectory));
}

function readForwardedArguments(run: ShimRun): string[] {
  const line = run.stdout.split(/\r?\n/).find((outputLine) => outputLine.startsWith(CLI_OUTPUT_PREFIX));
  assert.ok(line, `The fake CLI did not run.\nexit: ${run.status}\nstdout:\n${run.stdout}\nstderr:\n${run.stderr}`);
  return JSON.parse(line.slice(CLI_OUTPUT_PREFIX.length)) as string[];
}

test('redirect bin starts the CLI that @cloudcli-ai/cloudcli declares in its package.json bin', async () => {
  await withFixture(async (fixtureRoot) => {
    // An entry point at a path the shim has never hard-coded, as after the next move.
    const shimDirectory = await installHoisted(fixtureRoot, {
      packageJson: { bin: { cloudcli: 'build/next-cli/entry.js' } },
      files: { 'build/next-cli/entry.js': FAKE_CLI_SOURCE },
    });

    const run = runShimBin(shimDirectory, ['status', '--port', '4000']);

    assert.deepEqual(readForwardedArguments(run), ['status', '--port', '4000']);
    assert.equal(run.status, 0, run.stderr);
  });
});

test('redirect bin finds @cloudcli-ai/cloudcli nested under itself, as `npm install -g` lays it out', async () => {
  await withFixture(async (fixtureRoot) => {
    const shimDirectory = path.join(fixtureRoot, 'lib', 'node_modules', '@siteboon', 'claude-code-ui');
    await installShim(shimDirectory);
    await installFakeTarget(path.join(shimDirectory, 'node_modules', '@cloudcli-ai', 'cloudcli'), {
      packageJson: { bin: { cloudcli: 'dist-server/server/modules/cli/cli.js' } },
      files: { 'dist-server/server/modules/cli/cli.js': FAKE_CLI_SOURCE },
    });

    const run = runShimBin(shimDirectory, ['--version']);

    assert.deepEqual(readForwardedArguments(run), ['--version']);
    assert.equal(run.status, 0, run.stderr);
  });
});

test('redirect bin accepts a string bin and keeps the exit code the CLI sets', async () => {
  await withFixture(async (fixtureRoot) => {
    const shimDirectory = await installHoisted(fixtureRoot, {
      packageJson: { bin: 'cli.js' },
      files: { 'cli.js': `${FAKE_CLI_SOURCE}process.exitCode = 7;\n` },
    });

    const run = runShimBin(shimDirectory, ['help']);

    assert.deepEqual(readForwardedArguments(run), ['help']);
    assert.equal(run.status, 7);
  });
});

// require(esm) is unflagged from Node 20.19 / 22.12; on older builds a plain require() of any ESM bin fails.
test('redirect bin can be loaded with a plain require()', {
  skip: process.features.require_module ? false : 'this Node build cannot require() ES modules',
}, async () => {
  await withFixture(async (fixtureRoot) => {
    const shimDirectory = await installHoisted(fixtureRoot, {
      packageJson: { bin: { cloudcli: 'cli.js' } },
      files: { 'cli.js': FAKE_CLI_SOURCE },
    });
    const binPath = JSON.stringify(path.join(shimDirectory, 'bin.js'));

    // require(esm) refuses a module graph with top-level await (ERR_REQUIRE_ASYNC_MODULE). The argv splice makes
    // process.argv look like `node bin.js start`, as a CommonJS wrapper that loads the script would set it.
    const run = runNode(
      [
        '--input-type=commonjs',
        '--eval',
        `process.argv.splice(1, 0, ${binPath}); require(${binPath});`,
        '--',
        'start',
      ],
      fixtureRoot,
    );

    assert.doesNotMatch(run.stderr, /ERR_REQUIRE_ASYNC_MODULE/);
    assert.deepEqual(readForwardedArguments(run), ['start']);
    assert.equal(run.status, 0, run.stderr);
  });
});

test('redirect bin prints the error and exits non-zero when the CLI fails to load', async () => {
  await withFixture(async (fixtureRoot) => {
    const shimDirectory = await installHoisted(fixtureRoot, {
      packageJson: { bin: { cloudcli: 'cli.js' } },
      // The open interval would keep the process alive if the failure only set process.exitCode.
      files: { 'cli.js': "setInterval(() => {}, 60_000);\nthrow new Error('fake cloudcli failed to load');\n" },
    });

    const run = runShimBin(shimDirectory, ['--version']);

    assert.equal(run.status, 1, run.stderr);
    assert.match(run.stderr, /fake cloudcli failed to load/);
  });
});

test('redirect bin still finds the CLI when an exports map hides package.json', async () => {
  await withFixture(async (fixtureRoot) => {
    const shimDirectory = await installHoisted(fixtureRoot, {
      packageJson: { exports: { '.': './main.js' }, bin: { cloudcli: 'cli.js' } },
      files: { 'main.js': 'export {};\n', 'cli.js': FAKE_CLI_SOURCE },
    });

    const run = runShimBin(shimDirectory, ['--help']);

    assert.deepEqual(readForwardedArguments(run), ['--help']);
    assert.equal(run.status, 0, run.stderr);
  });
});

test('redirect bin explains how to install the CLI when @cloudcli-ai/cloudcli is missing', async () => {
  await withFixture(async (fixtureRoot) => {
    // Assumes @cloudcli-ai/cloudcli can't be resolved from os.tmpdir()'s parent folders or Node's global folders.
    const shimDirectory = await installHoisted(fixtureRoot, null);

    const run = runShimBin(shimDirectory, ['--version']);

    assert.equal(run.status, 1);
    assert.match(run.stderr, /could not find the @cloudcli-ai\/cloudcli CLI/);
    assert.match(run.stderr, /npm install -g @cloudcli-ai\/cloudcli/);
    assert.doesNotMatch(run.stderr, STACK_FRAME_PATTERN);
  });
});

test('redirect bin reports a @cloudcli-ai/cloudcli package that declares no cloudcli bin', async () => {
  await withFixture(async (fixtureRoot) => {
    const shimDirectory = await installHoisted(fixtureRoot, {
      packageJson: { bin: { other: 'other.js' } },
      files: { 'other.js': FAKE_CLI_SOURCE },
    });

    const run = runShimBin(shimDirectory, ['--version']);

    assert.equal(run.status, 1);
    assert.match(run.stderr, /does not declare a "cloudcli" bin/);
    assert.doesNotMatch(run.stderr, STACK_FRAME_PATTERN);
    assert.equal(run.stdout.includes(CLI_OUTPUT_PREFIX), false);
  });
});

test('redirect package main re-exports @cloudcli-ai/cloudcli even though it has no default export', async () => {
  await withFixture(async (fixtureRoot) => {
    await installHoisted(fixtureRoot, {
      packageJson: { main: 'main.js' },
      files: { 'main.js': "export const marker = 'cloudcli-main';\n" },
    });

    const run = runNode(
      [
        '--input-type=module',
        '--eval',
        "const shim = await import('@siteboon/claude-code-ui'); console.log(JSON.stringify(Object.keys(shim)));",
      ],
      fixtureRoot,
    );

    assert.equal(run.status, 0, run.stderr);
    assert.equal(run.stdout.trim(), '["marker"]');
  });
});
