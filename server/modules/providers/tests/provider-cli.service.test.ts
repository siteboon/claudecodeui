import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test, { afterEach, mock } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';

import spawn from 'cross-spawn';

import { ClaudeProviderAuth } from '@/modules/providers/list/claude/claude-auth.provider.js';
import { CodexProviderAuth } from '@/modules/providers/list/codex/codex-auth.provider.js';
import { CursorProviderAuth } from '@/modules/providers/list/cursor/cursor-auth.provider.js';
import { OpenCodeProviderAuth } from '@/modules/providers/list/opencode/opencode-auth.provider.js';
import { createProviderCliService } from '@/modules/providers/services/provider-cli.service.js';
import type { LLMProvider } from '@/shared/types.js';
import { AppError } from '@/shared/utils.js';

const findEnvKey = (name: string) =>
  Object.keys(process.env).find((key) => key.toLowerCase() === name.toLowerCase()) || name;
const pathKey = findEnvKey('PATH');
const pathExtKey = findEnvKey('PATHEXT');

// A stand-in CLI driven by files in its own state folder, so a test can set what
// `--version` prints and what the updater does without touching any real install.
//   version            text `--version` prints (exit code from version-exit)
//   version-count      incremented on every `--version` run
//   update-new-version written into `version` by a successful update
//   update-stdout/-stderr, update-exit, update-sleep-ms shape the update run
//   update-count       incremented on every update run
//   update-finished    written when an update ran to the end (a killed one never does)
//   ignore-sigterm     the update run survives SIGTERM, so only SIGKILL stops it
//   child-sleep-ms     the update run starts a child (its pid in child-pid) that
//                      writes child-finished after this long; with child-holds-output
//                      the child keeps the update run's stdout and stderr open
//   lock-after-version `--version` drops the execute bit after answering
const FAKE_CLI_SCRIPT = `
const fs = require('node:fs');
const path = require('node:path');
const dir = __dirname;
const read = (name, fallback) => (fs.existsSync(path.join(dir, name)) ? fs.readFileSync(path.join(dir, name), 'utf8') : fallback);
const command = process.argv[2];
if (command === '--version') {
  fs.writeFileSync(path.join(dir, 'version-count'), String(Number(read('version-count', '0')) + 1));
  process.stdout.write(read('version', ''));
  if (read('lock-after-version', '')) {
    fs.chmodSync(path.join(dir, '..', path.basename(__filename, '.cjs')), 0o644);
  }
  process.exit(Number(read('version-exit', '0')));
}
if (command === 'update' || command === 'upgrade') {
  fs.writeFileSync(path.join(dir, 'update-count'), String(Number(read('update-count', '0')) + 1));
  if (read('ignore-sigterm', '')) {
    process.on('SIGTERM', () => {});
  }
  const childSleepMs = read('child-sleep-ms', '');
  if (childSleepMs) {
    const child = require('node:child_process').spawn(
      process.execPath,
      ['-e', 'setTimeout(() => require("node:fs").writeFileSync(process.argv[1], ""), Number(process.argv[2]))', path.join(dir, 'child-finished'), childSleepMs],
      { stdio: read('child-holds-output', '') ? ['ignore', 'inherit', 'inherit'] : 'ignore' },
    );
    fs.writeFileSync(path.join(dir, 'child-pid'), String(child.pid));
  }
  process.stdout.write(read('update-stdout', ''));
  process.stderr.write(read('update-stderr', ''));
  setTimeout(() => {
    const next = read('update-new-version', '');
    if (next) {
      fs.writeFileSync(path.join(dir, 'version'), next);
    }
    fs.writeFileSync(path.join(dir, 'update-finished'), '');
    process.exit(Number(read('update-exit', '0')));
  }, Number(read('update-sleep-ms', '0')));
} else {
  process.stderr.write('unexpected arguments: ' + process.argv.slice(2).join(' '));
  process.exit(2);
}
`;

type FakeCli = {
  set(name: string, value: string): Promise<void>;
  read(name: string): Promise<string | null>;
};

/** Writes the fake CLI as `<dir>/<name>` (a `.cmd` shim on Windows), with its state beside the script. */
async function createFakeCli(dir: string, name: string): Promise<FakeCli> {
  const stateDir = path.join(dir, `.${name}-state`);
  await mkdir(stateDir, { recursive: true });
  const scriptPath = path.join(stateDir, `${name}.cjs`);
  await writeFile(scriptPath, FAKE_CLI_SCRIPT, 'utf8');

  if (process.platform === 'win32') {
    await writeFile(path.join(dir, `${name}.cmd`), `@echo off\r\n"${process.execPath}" "${scriptPath}" %*\r\n`, 'utf8');
  } else {
    // exec, so a signal sent to the updater reaches the node process itself.
    const commandPath = path.join(dir, name);
    await writeFile(commandPath, `#!/bin/sh\nexec "${process.execPath}" "${scriptPath}" "$@"\n`, 'utf8');
    await chmod(commandPath, 0o755);
  }

  return {
    set: (file, value) => writeFile(path.join(stateDir, file), value, 'utf8'),
    read: async (file) => (existsSync(path.join(stateDir, file)) ? readFile(path.join(stateDir, file), 'utf8') : null),
  };
}

/**
 * Runs `fn` with a temp dir whose `bin` is the only PATH entry and with
 * CLAUDE_CLI_PATH pointing into it, so no real CLI on this machine is found.
 */
async function withIsolatedCliEnv(fn: (binDir: string) => Promise<void>): Promise<void> {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'provider-cli-test-'));
  const binDir = path.join(rootDir, 'bin');
  await mkdir(binDir, { recursive: true });
  const previous = {
    [pathKey]: process.env[pathKey],
    [pathExtKey]: process.env[pathExtKey],
    CLAUDE_CLI_PATH: process.env.CLAUDE_CLI_PATH,
  };

  process.env[pathKey] = binDir;
  process.env.CLAUDE_CLI_PATH = path.join(binDir, process.platform === 'win32' ? 'claude.cmd' : 'claude');
  if (process.platform === 'win32') {
    process.env[pathExtKey] = '.COM;.EXE;.BAT;.CMD';
  }

  try {
    await fn(binDir);
  } finally {
    // Assigning undefined to process.env stores the string "undefined", so unset keys are deleted.
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    await rm(rootDir, { recursive: true, force: true });
  }
}

type FetchCall = { url: string };

/** A registry stand-in that answers `latest` for every package with the given version. */
function createFakeRegistry(answer: () => Promise<Response>) {
  const calls: FetchCall[] = [];
  const fetchImpl = (async (input: string | URL | Request) => {
    calls.push({ url: String(input) });
    return answer();
  }) as typeof fetch;
  return { calls, fetch: fetchImpl };
}

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

// The default registry of createService: a test that does not pass its own
// expects no lookup. The service swallows registry errors, so a throwing fetch
// would go unnoticed; the calls are recorded and checked after every test.
const unexpectedRegistryCalls: string[] = [];
afterEach(() => {
  assert.deepEqual(unexpectedRegistryCalls.splice(0), [], 'the registry must not be contacted in this test');
});

const createService = (overrides: Parameters<typeof createProviderCliService>[0] = {}) => createProviderCliService({
  listBusyProviders: async () => [],
  platformMode: false,
  fetch: (async (input: string | URL | Request) => {
    unexpectedRegistryCalls.push(String(input));
    throw new Error('the registry must not be contacted in this test');
  }) as typeof fetch,
  ...overrides,
});

/** Rejects when `promise` has not settled within `ms`, instead of letting the test hang. */
async function withDeadline<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  try {
    return await Promise.race([promise, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

/** Resolves once the fake CLI has written `file`, e.g. `update-count` when its updater started. */
async function waitForFakeCliFile(cli: FakeCli, file: string): Promise<void> {
  const deadline = Date.now() + 5000;
  while ((await cli.read(file)) === null) {
    assert.ok(Date.now() < deadline, `the fake CLI never wrote ${file}`);
    await delay(20);
  }
}

const rejectsWithAppError = async (promise: Promise<unknown>, code: string, statusCode: number) => {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof AppError, `expected an AppError, got ${String(error)}`);
    assert.equal(error.code, code);
    assert.equal(error.statusCode, statusCode);
    return true;
  });
};

// ----------------- installed version in the auth status ------------

test('each provider reports the version its CLI prints for --version', async () => {
  await withIsolatedCliEnv(async (binDir) => {
    const claude = await createFakeCli(binDir, 'claude');
    await claude.set('version', '2.1.295 (Claude Code)\n');
    const cursor = await createFakeCli(binDir, 'cursor-agent');
    await cursor.set('version', '2026.07.20-8cc9c0b\n');
    const opencode = await createFakeCli(binDir, 'opencode');
    await opencode.set('version', '1.18.25\n');

    assert.deepEqual(new ClaudeProviderAuth().checkInstalled(), { installed: true, exitCode: 0, version: '2.1.295' });
    assert.equal(new CursorProviderAuth().checkInstalled().version, '2026.07.20-8cc9c0b');
    const openCodeStatus = await new OpenCodeProviderAuth().getStatus();
    assert.equal(openCodeStatus.installed, true);
    assert.equal(openCodeStatus.installedVersion, '1.18.25');

    // Codex chats run the @openai/codex build CloudCLI depends on, not a `codex` on PATH.
    const bundledCodex = createRequire(import.meta.url)('@openai/codex/package.json') as { version: string };
    const codexStatus = await new CodexProviderAuth().getStatus();
    assert.equal(codexStatus.installed, true);
    assert.equal(codexStatus.installedVersion, bundledCodex.version);
  });
});

test('a CLI that cannot be started is reported as not installed, with no version', async () => {
  await withIsolatedCliEnv(async () => {
    // cross-spawn's sync spawn returns ENOENT instead of throwing, which used to read as installed.
    const claudeStatus = await new ClaudeProviderAuth().getStatus();
    assert.equal(claudeStatus.installed, false);
    assert.equal(claudeStatus.installedVersion, null);
    assert.equal(claudeStatus.error, 'Claude Code CLI is not installed');

    const cursorStatus = await new CursorProviderAuth().getStatus();
    assert.equal(cursorStatus.installed, false);
    assert.equal(cursorStatus.installedVersion, null);
    assert.equal(cursorStatus.error, 'Cursor CLI is not installed');

    const openCodeStatus = await new OpenCodeProviderAuth().getStatus();
    assert.equal(openCodeStatus.installed, false);
    assert.equal(openCodeStatus.installedVersion, null);
  });
});

test('a --version that exits non-zero or prints no version leaves the version unknown', async () => {
  await withIsolatedCliEnv(async (binDir) => {
    const claude = await createFakeCli(binDir, 'claude');
    await claude.set('version', 'Error: 9.9.9 is not a valid config\n');
    await claude.set('version-exit', '1');
    // Started, so installed (as before); the failing exit only hides the version.
    assert.deepEqual(new ClaudeProviderAuth().checkInstalled(), { installed: true, exitCode: 1, version: null });

    const opencode = await createFakeCli(binDir, 'opencode');
    await opencode.set('version', 'dev build\n');
    assert.deepEqual(new OpenCodeProviderAuth().checkInstalled(), { installed: true, exitCode: 0, version: null });
    // OpenCode keeps requiring a clean exit to count as installed.
    await opencode.set('version-exit', '3');
    assert.equal(new OpenCodeProviderAuth().checkInstalled().installed, false);
  });
});

test('a --version that timed out still counts as installed, with an unknown version', async () => {
  await withIsolatedCliEnv(async () => {
    // What cross-spawn returns when the 5 s probe is killed: the CLI started and was slow.
    const timedOut = Object.assign(new Error('spawnSync claude ETIMEDOUT'), { code: 'ETIMEDOUT' });
    const versionProbe = mock.method(spawn, 'sync', () => ({
      pid: 1,
      output: [],
      stdout: '',
      stderr: '',
      status: null,
      signal: 'SIGTERM' as const,
      error: timedOut,
    }));
    try {
      assert.deepEqual(new ClaudeProviderAuth().checkInstalled(), { installed: true, exitCode: null, version: null });
      assert.deepEqual(new CursorProviderAuth().checkInstalled(), { installed: true, exitCode: null, version: null });
      // OpenCode needs a clean exit, as before.
      assert.equal(new OpenCodeProviderAuth().checkInstalled().installed, false);
      assert.equal(versionProbe.mock.callCount(), 3);
    } finally {
      versionProbe.mock.restore();
    }
  });
});

// ----------------- latest version from the npm registry ------------

test('getCliStatus compares with the npm latest release and caches it for an hour', async () => {
  await withIsolatedCliEnv(async (binDir) => {
    const claude = await createFakeCli(binDir, 'claude');
    await claude.set('version', '2.1.200 (Claude Code)\n');
    let now = 1_000_000;
    const registry = createFakeRegistry(async () => jsonResponse({ name: '@anthropic-ai/claude-code', version: '2.1.300' }));
    const service = createService({ fetch: registry.fetch, now: () => now });

    const status = await service.getCliStatus('claude');
    assert.deepEqual(status, {
      provider: 'claude',
      installed: true,
      installedVersion: '2.1.200',
      latestVersion: '2.1.300',
      updateAvailable: true,
      updateCommand: `${process.env.CLAUDE_CLI_PATH} update`,
      updateUnavailableReason: null,
      updateInProgress: false,
      lastUpdate: null,
    });
    assert.deepEqual(registry.calls.map((call) => call.url), ['https://registry.npmjs.org/@anthropic-ai%2Fclaude-code/latest']);

    now += 59 * 60 * 1000;
    await claude.set('version', '2.1.300 (Claude Code)\n');
    const upToDate = await service.getCliStatus('claude');
    assert.equal(upToDate.updateAvailable, false);
    assert.equal(registry.calls.length, 1, 'answered from the cache within the hour');

    now += 2 * 60 * 1000;
    await service.getCliStatus('claude');
    assert.equal(registry.calls.length, 2, 'asked again once the hour is over');
  });
});

test('getCliStatus never fails on an unreachable registry and does not retry it on every call', async () => {
  await withIsolatedCliEnv(async (binDir) => {
    const opencode = await createFakeCli(binDir, 'opencode');
    await opencode.set('version', '1.18.20\n');
    let now = 0;
    let answer: () => Promise<Response> = async () => {
      throw new TypeError('fetch failed');
    };
    const registry = createFakeRegistry(() => answer());
    const service = createService({ fetch: registry.fetch, now: () => now });

    const offline = await service.getCliStatus('opencode');
    assert.equal(offline.installedVersion, '1.18.20');
    assert.equal(offline.latestVersion, null);
    assert.equal(offline.updateAvailable, false);
    assert.equal(offline.updateCommand, 'opencode upgrade');

    await service.getCliStatus('opencode');
    assert.equal(registry.calls.length, 1, 'a failure is remembered for a while');

    now += 6 * 60 * 1000;
    answer = async () => jsonResponse({ error: 'Not found' }, 404);
    assert.equal((await service.getCliStatus('opencode')).latestVersion, null);
    assert.equal(registry.calls.length, 2);

    now += 6 * 60 * 1000;
    answer = async () => jsonResponse({ version: 'not-a-version' });
    assert.equal((await service.getCliStatus('opencode')).latestVersion, null);
  });
});

test('concurrent getCliStatus calls share one registry request', async () => {
  await withIsolatedCliEnv(async (binDir) => {
    const opencode = await createFakeCli(binDir, 'opencode');
    await opencode.set('version', '1.18.20\n');
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const registry = createFakeRegistry(async () => {
      await gate;
      return jsonResponse({ version: '1.19.0' });
    });
    const service = createService({ fetch: registry.fetch });

    const pending = [service.getCliStatus('opencode'), service.getCliStatus('opencode')];
    release();
    const results = await Promise.all(pending);
    assert.deepEqual(results.map((result) => result.latestVersion), ['1.19.0', '1.19.0']);
    assert.equal(registry.calls.length, 1);
  });
});

test('getCliStatus gives up on a registry that never answers', async () => {
  await withIsolatedCliEnv(async (binDir) => {
    const opencode = await createFakeCli(binDir, 'opencode');
    await opencode.set('version', '1.18.20\n');
    const signals: unknown[] = [];
    // Settles only when the lookup's own signal aborts it, like a proxy that accepts and never replies.
    const silentRegistry = ((_input: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      signals.push(init?.signal);
      init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
    })) as typeof fetch;
    const service = createService({ fetch: silentRegistry, latestVersionTimeoutMs: 50 });

    const status = await withDeadline(service.getCliStatus('opencode'), 3000, 'the status waited on the registry');
    assert.equal(status.installedVersion, '1.18.20');
    assert.equal(status.latestVersion, null);
    assert.equal(signals.length, 1);
    assert.ok(signals[0] instanceof AbortSignal);
  });
});

test('a release outranks its own prerelease, and a prerelease never outranks its release', async () => {
  await withIsolatedCliEnv(async (binDir) => {
    const claude = await createFakeCli(binDir, 'claude');
    let latest = '2.1.300';
    const registry = createFakeRegistry(async () => jsonResponse({ version: latest }));

    await claude.set('version', '2.1.300-beta.1 (Claude Code)\n');
    const onPrerelease = await createService({ fetch: registry.fetch }).getCliStatus('claude');
    assert.equal(onPrerelease.installedVersion, '2.1.300-beta.1');
    assert.equal(onPrerelease.updateAvailable, true);

    await claude.set('version', '2.1.300 (Claude Code)\n');
    latest = '2.1.300-beta.1';
    assert.equal((await createService({ fetch: registry.fetch }).getCliStatus('claude')).updateAvailable, false);
    assert.equal(registry.calls.length, 2);
  });
});

test('getCliStatus does not ask the registry about a CLI that is not installed', async () => {
  await withIsolatedCliEnv(async () => {
    const registry = createFakeRegistry(async () => jsonResponse({ version: '2.1.300' }));
    const status = await createService({ fetch: registry.fetch }).getCliStatus('claude');
    assert.equal(status.installed, false);
    assert.equal(status.latestVersion, null);
    assert.equal(registry.calls.length, 0);
  });
});

test('Cursor has no npm release to compare with; Codex ships with CloudCLI; platform mode offers no update', async () => {
  await withIsolatedCliEnv(async (binDir) => {
    const cursor = await createFakeCli(binDir, 'cursor-agent');
    await cursor.set('version', '2026.07.20-8cc9c0b\n');
    const service = createService();

    const cursorStatus = await service.getCliStatus('cursor');
    assert.equal(cursorStatus.latestVersion, null);
    assert.equal(cursorStatus.updateCommand, 'cursor-agent update');
    assert.equal(cursorStatus.updateUnavailableReason, null);

    const codexStatus = await service.getCliStatus('codex');
    assert.equal(codexStatus.installed, true);
    assert.equal(codexStatus.updateCommand, null);
    assert.equal(codexStatus.updateUnavailableReason, 'bundled');
    await rejectsWithAppError(service.updateCli('codex'), 'PROVIDER_CLI_UPDATE_UNAVAILABLE', 400);

    const platformService = createService({ platformMode: true });
    const platformStatus = await platformService.getCliStatus('cursor');
    assert.equal(platformStatus.installedVersion, '2026.07.20-8cc9c0b');
    assert.equal(platformStatus.updateCommand, null);
    assert.equal(platformStatus.updateUnavailableReason, 'platform');
    await rejectsWithAppError(platformService.updateCli('cursor'), 'PROVIDER_CLI_UPDATE_UNAVAILABLE', 403);
    assert.equal(await cursor.read('update-count'), null);

    // A CLI that is on npm is not looked up either: the platform, not this server, updates it.
    // (createService's default registry fails the test when it is asked.)
    const claude = await createFakeCli(binDir, 'claude');
    await claude.set('version', '2.1.200 (Claude Code)\n');
    const platformClaude = await platformService.getCliStatus('claude');
    assert.equal(platformClaude.installedVersion, '2.1.200');
    assert.equal(platformClaude.latestVersion, null);
    assert.equal(platformClaude.updateAvailable, false);
  });
});

// ----------------- the update action ------------

test('updateCli runs the CLI\'s own updater and reports the version before and after', async () => {
  await withIsolatedCliEnv(async (binDir) => {
    const claude = await createFakeCli(binDir, 'claude');
    await claude.set('version', '2.1.200 (Claude Code)\n');
    await claude.set('update-stdout', 'Current version: 2.1.200\nSuccessfully updated from 2.1.200 to version 2.1.300\n');
    await claude.set('update-new-version', '2.1.300 (Claude Code)\n');

    const result = await createService().updateCli('claude');
    assert.deepEqual(result, {
      provider: 'claude',
      command: `${process.env.CLAUDE_CLI_PATH} update`,
      exitCode: 0,
      output: 'Current version: 2.1.200\nSuccessfully updated from 2.1.200 to version 2.1.300',
      previousVersion: '2.1.200',
      installedVersion: '2.1.300',
      failure: null,
    });

    const opencode = await createFakeCli(binDir, 'opencode');
    await opencode.set('version', '1.18.20\n');
    await opencode.set('update-new-version', '1.19.0\n');
    const openCodeResult = await createService().updateCli('opencode');
    assert.equal(openCodeResult.command, 'opencode upgrade');
    assert.equal(openCodeResult.installedVersion, '1.19.0');
    assert.equal(await opencode.read('update-count'), '1');
  });
});

test('updateCli refuses while the provider is busy in a session and does not start the updater', async () => {
  await withIsolatedCliEnv(async (binDir) => {
    const claude = await createFakeCli(binDir, 'claude');
    await claude.set('version', '2.1.200 (Claude Code)\n');
    const busy: LLMProvider[] = ['claude'];
    const registry = createFakeRegistry(async () => jsonResponse({ version: '2.1.300' }));
    const service = createService({ listBusyProviders: async () => busy, fetch: registry.fetch });

    await rejectsWithAppError(service.updateCli('claude'), 'PROVIDER_CLI_BUSY', 409);
    assert.equal(await claude.read('update-count'), null);
    // A refused request is no run: nothing is reported as running or finished.
    const afterRefusal = await service.getCliStatus('claude');
    assert.equal(afterRefusal.updateInProgress, false);
    assert.equal(afterRefusal.lastUpdate, null);

    // Another provider's activity does not block it.
    busy.splice(0, 1, 'codex');
    await service.updateCli('claude');
    assert.equal(await claude.read('update-count'), '1');
  });
});

test('updateCli refuses when the CLI is not installed', async () => {
  await withIsolatedCliEnv(async () => {
    await rejectsWithAppError(createService().updateCli('cursor'), 'PROVIDER_CLI_NOT_INSTALLED', 409);
  });
});

test('updateCli reports a refused write as permission_denied, whatever the updater exits with', async () => {
  await withIsolatedCliEnv(async (binDir) => {
    const claude = await createFakeCli(binDir, 'claude');
    await claude.set('version', '2.1.200 (Claude Code)\n');
    // What `claude update` prints for an npm-global install the server user cannot write to.
    await claude.set('update-stderr', 'Error: Insufficient permissions to install update\nTry running with sudo or fix npm permissions\n');
    await claude.set('update-exit', '1');
    const claudeResult = await createService().updateCli('claude');
    assert.equal(claudeResult.exitCode, 1);
    assert.equal(claudeResult.failure, 'permission_denied');
    assert.equal(claudeResult.installedVersion, '2.1.200');
    assert.match(claudeResult.output, /Insufficient permissions/);

    // npm's own wording, as an updater that shells out to `npm install -g` passes it on.
    const opencode = await createFakeCli(binDir, 'opencode');
    await opencode.set('version', '1.18.20\n');
    await opencode.set('update-stderr', "npm error code EACCES\nnpm error Error: EACCES: permission denied, mkdir '/usr/lib/node_modules/opencode-ai'\n");
    await opencode.set('update-exit', '0');
    const openCodeResult = await createService().updateCli('opencode');
    assert.equal(openCodeResult.exitCode, 0);
    assert.equal(openCodeResult.failure, 'permission_denied');

    // Any other non-zero exit is a plain failure.
    await claude.set('update-stderr', 'Failed to check for updates\n');
    assert.equal((await createService().updateCli('claude')).failure, 'failed');
  });
});

test('updateCli stops an updater that runs past the timeout, and the child it started', {
  skip: process.platform === 'win32' ? 'POSIX process groups' : false,
}, async () => {
  await withIsolatedCliEnv(async (binDir) => {
    const cursor = await createFakeCli(binDir, 'cursor-agent');
    await cursor.set('version', '2026.07.20-8cc9c0b\n');
    // An updater that ignores SIGTERM and has a download child running, as
    // `claude update` has npm: only SIGKILL to the whole group stops both.
    await cursor.set('ignore-sigterm', '1');
    await cursor.set('child-sleep-ms', '2500');
    await cursor.set('update-sleep-ms', '2500');
    await cursor.set('update-new-version', '2026.10.09-1a2b3c4\n');

    const startedAt = Date.now();
    const result = await createService({ updateTimeoutMs: 1000, updateKillGraceMs: 300 }).updateCli('cursor');
    assert.equal(result.failure, 'timed_out');
    assert.equal(result.exitCode, null);
    assert.equal(result.installedVersion, '2026.07.20-8cc9c0b');
    assert.ok(Date.now() - startedAt < 2500, 'the result came from the kill, not from the updater finishing');
    assert.ok(await cursor.read('child-pid'), 'the updater had started its child');

    // Past the point where either would have finished on its own.
    await delay(Math.max(0, startedAt + 3500 - Date.now()));
    assert.equal(await cursor.read('update-finished'), null, 'the updater was stopped');
    assert.equal(await cursor.read('child-finished'), null, 'its child was stopped with it');
  });
});

test('updateCli returns once the updater exits, even when a process it left behind holds its output open', {
  skip: process.platform === 'win32' ? 'POSIX pipes' : false,
}, async () => {
  await withIsolatedCliEnv(async (binDir) => {
    const opencode = await createFakeCli(binDir, 'opencode');
    await opencode.set('version', '1.18.20\n');
    await opencode.set('update-new-version', '1.19.0\n');
    await opencode.set('child-sleep-ms', '15000');
    await opencode.set('child-holds-output', '1');

    const startedAt = Date.now();
    try {
      const result = await createService().updateCli('opencode');
      assert.equal(result.exitCode, 0);
      assert.equal(result.failure, null);
      assert.equal(result.installedVersion, '1.19.0');
      assert.ok(Date.now() - startedAt < 8000, 'the result did not wait for the left-behind process');
    } finally {
      const childPid = Number(await opencode.read('child-pid'));
      if (childPid) {
        try {
          process.kill(childPid, 'SIGKILL');
        } catch {
          // Already gone.
        }
      }
    }
  });
});

test('updateCli reports an updater the server may not start as permission_denied', {
  skip: process.platform === 'win32' ? 'POSIX execute bit' : false,
}, async () => {
  await withIsolatedCliEnv(async (binDir) => {
    const claude = await createFakeCli(binDir, 'claude');
    await claude.set('version', '2.1.200 (Claude Code)\n');
    // Answers the version check, then loses its execute bit: the update spawn fails with EACCES.
    await claude.set('lock-after-version', '1');

    const result = await createService().updateCli('claude');
    assert.equal(result.exitCode, null);
    assert.equal(result.failure, 'permission_denied');
    assert.equal(result.previousVersion, '2.1.200');
    assert.equal(await claude.read('update-count'), null);
  });
});

test('a second update request while one runs gets the same run instead of a second updater', async () => {
  await withIsolatedCliEnv(async (binDir) => {
    const opencode = await createFakeCli(binDir, 'opencode');
    await opencode.set('version', '1.18.20\n');
    await opencode.set('update-sleep-ms', '300');
    await opencode.set('update-new-version', '1.19.0\n');
    const service = createService();

    const [first, second] = await Promise.all([service.updateCli('opencode'), service.updateCli('opencode')]);
    assert.equal(first, second);
    assert.equal(await opencode.read('update-count'), '1');

    // Once it has finished, a new request runs the updater again.
    await service.updateCli('opencode');
    assert.equal(await opencode.read('update-count'), '2');
  });
});

test('getCliStatus reports a running update and, once it is over, that run\'s result', async () => {
  await withIsolatedCliEnv(async (binDir) => {
    const opencode = await createFakeCli(binDir, 'opencode');
    await opencode.set('version', '1.18.20\n');
    await opencode.set('update-sleep-ms', '300');
    await opencode.set('update-new-version', '1.19.0\n');
    const registry = createFakeRegistry(async () => jsonResponse({ version: '1.19.0' }));
    const service = createService({ fetch: registry.fetch });

    const before = await service.getCliStatus('opencode');
    assert.equal(before.updateInProgress, false);
    assert.equal(before.lastUpdate, null);

    // A page that mounts while the update runs (or lost the update request) sees it running...
    const running = service.updateCli('opencode');
    await waitForFakeCliFile(opencode, 'update-count');
    const during = await service.getCliStatus('opencode');
    assert.equal(during.updateInProgress, true);
    assert.equal(during.lastUpdate, null);

    // ...and, once it is over, gets the run's result with the new version.
    const result = await running;
    const after = await service.getCliStatus('opencode');
    assert.equal(after.updateInProgress, false);
    assert.deepEqual(after.lastUpdate, result);
    assert.equal(after.installedVersion, '1.19.0');
    assert.equal(after.updateAvailable, false);
  });
});

test('getCliStatus does not run --version while an update runs, and reports the version from before it', async () => {
  await withIsolatedCliEnv(async (binDir) => {
    const cursor = await createFakeCli(binDir, 'cursor-agent');
    await cursor.set('version', '2026.07.20-8cc9c0b\n');
    await cursor.set('update-sleep-ms', '600');
    await cursor.set('update-new-version', '2026.10.14-941492e\n');
    const service = createService();

    const running = service.updateCli('cursor');
    await waitForFakeCliFile(cursor, 'update-count');
    // The probe that recorded the version before the run.
    assert.equal(await cursor.read('version-count'), '1');

    // A page that follows the run asks every few seconds. A `--version` per
    // answer would block the server each time and run the binary the updater
    // is replacing.
    for (let poll = 0; poll < 3; poll += 1) {
      const during = await service.getCliStatus('cursor');
      assert.equal(during.updateInProgress, true);
      assert.equal(during.installed, true);
      assert.equal(during.installedVersion, '2026.07.20-8cc9c0b');
    }
    assert.equal(await cursor.read('version-count'), '1', 'no --version ran while the update was running');

    const result = await running;
    assert.equal(result.installedVersion, '2026.10.14-941492e');
    // Once the run is over, the status probes again and shows the new version.
    const after = await service.getCliStatus('cursor');
    assert.equal(after.updateInProgress, false);
    assert.equal(after.installedVersion, '2026.10.14-941492e');
    assert.equal(await cursor.read('version-count'), '3');
  });
});

test('getCliStatus probes again when the update it saw running ended during the registry lookup', async () => {
  await withIsolatedCliEnv(async (binDir) => {
    const opencode = await createFakeCli(binDir, 'opencode');
    await opencode.set('version', '1.18.20\n');
    await opencode.set('update-sleep-ms', '300');
    await opencode.set('update-new-version', '1.19.0\n');
    // The registry answers only once the test lets it, as an expired cache
    // entry behind a slow mirror would.
    let answerRegistry: () => void = () => {};
    const registryAnswered = new Promise<void>((resolve) => {
      answerRegistry = resolve;
    });
    const registry = createFakeRegistry(async () => {
      await registryAnswered;
      return jsonResponse({ version: '1.19.0' });
    });
    const service = createService({ fetch: registry.fetch });

    const running = service.updateCli('opencode');
    await waitForFakeCliFile(opencode, 'update-count');
    // Starts while the run is going on, then waits on the registry...
    const status = service.getCliStatus('opencode');
    // ...while the run ends and replaces the binary.
    const result = await withDeadline(running, 5000, 'the update never finished');
    answerRegistry();
    const reported = await withDeadline(status, 5000, 'the status never answered');

    assert.equal(result.installedVersion, '1.19.0');
    assert.equal(reported.updateInProgress, false);
    assert.deepEqual(reported.lastUpdate, result);
    assert.equal(reported.installedVersion, '1.19.0');
    assert.equal(reported.updateAvailable, false);
    // The run's probes before and after the updater, then the status's one re-probe.
    assert.equal(await opencode.read('version-count'), '3');
  });
});

test('getCliStatus reports the starting version of a run that began during the registry lookup', async () => {
  await withIsolatedCliEnv(async (binDir) => {
    const opencode = await createFakeCli(binDir, 'opencode');
    await opencode.set('version', '1.18.20\n');
    await opencode.set('update-sleep-ms', '300');
    await opencode.set('update-new-version', '1.19.0\n');
    let answerRegistry: () => void = () => {};
    const registryAnswered = new Promise<void>((resolve) => {
      answerRegistry = resolve;
    });
    const registry = createFakeRegistry(async () => {
      await registryAnswered;
      return jsonResponse({ version: '1.20.0' });
    });
    const service = createService({ fetch: registry.fetch });

    const firstRun = service.updateCli('opencode');
    await waitForFakeCliFile(opencode, 'update-count');
    const status = service.getCliStatus('opencode');
    const firstResult = await withDeadline(firstRun, 5000, 'the first update never finished');

    // A second run starts before the registry answers the status.
    await opencode.set('update-sleep-ms', '2000');
    await opencode.set('update-new-version', '1.20.0\n');
    const secondRun = service.updateCli('opencode');
    const deadline = Date.now() + 5000;
    while ((await opencode.read('update-count')) !== '2') {
      assert.ok(Date.now() < deadline, 'the second updater never started');
      await delay(20);
    }
    // Before and after the first run, before the second.
    assert.equal(await opencode.read('version-count'), '3');
    answerRegistry();
    const reported = await withDeadline(status, 5000, 'the status never answered');

    assert.equal(await opencode.read('version-count'), '3', 'no --version ran while the second update was running');
    assert.equal(reported.updateInProgress, true);
    assert.equal(reported.installedVersion, '1.19.0');
    assert.deepEqual(reported.lastUpdate, firstResult);
    assert.equal(reported.updateAvailable, true);

    const secondResult = await withDeadline(secondRun, 5000, 'the second update never finished');
    assert.equal(secondResult.installedVersion, '1.20.0');
  });
});

test('a request still in its busy check is not reported as a running update', async () => {
  await withIsolatedCliEnv(async (binDir) => {
    const cursor = await createFakeCli(binDir, 'cursor-agent');
    await cursor.set('version', '2026.07.20-8cc9c0b\n');
    let answerBusyCheck: (busy: LLMProvider[]) => void = () => {};
    const service = createService({
      listBusyProviders: () => new Promise<LLMProvider[]>((resolve) => {
        answerBusyCheck = resolve;
      }),
    });

    const refused = service.updateCli('cursor');
    // A row that mounts now must not follow a run that is about to be refused.
    const whileChecking = await service.getCliStatus('cursor');
    assert.equal(whileChecking.updateInProgress, false);

    answerBusyCheck(['cursor']);
    await rejectsWithAppError(refused, 'PROVIDER_CLI_BUSY', 409);
    const afterRefusal = await service.getCliStatus('cursor');
    assert.equal(afterRefusal.updateInProgress, false);
    assert.equal(afterRefusal.lastUpdate, null);
    assert.equal(await cursor.read('update-count'), null);
  });
});

test('updateCli keeps only the final state of spinner and progress-bar lines', async () => {
  await withIsolatedCliEnv(async (binDir) => {
    const cursor = await createFakeCli(binDir, 'cursor-agent');
    await cursor.set('version', '2026.07.20-8cc9c0b\n');
    await cursor.set('update-new-version', '2026.10.14-941492e\n');
    // `cursor-agent update` draws its download progress with carriage returns.
    await cursor.set(
      'update-stdout',
      'Checking for updates...\nLatest version available: 2026.10.14-941492e\n\r####      6.0%\r########  56.2%\r########## 100.0%\nDone\n',
    );

    const result = await createService().updateCli('cursor');
    assert.equal(result.output, 'Checking for updates...\nLatest version available: 2026.10.14-941492e\n########## 100.0%\nDone');
    assert.equal(result.failure, null);
    assert.equal(result.installedVersion, '2026.10.14-941492e');
  });
});

test('updateCli flags a failure that the updater only prints, as `opencode upgrade` does', async () => {
  await withIsolatedCliEnv(async (binDir) => {
    const opencode = await createFakeCli(binDir, 'opencode');
    await opencode.set('version', '1.19.0\n');
    // Recorded from opencode 1.19.0 upgrading into a read-only npm prefix: npm
    // exits 243 (EACCES), OpenCode prints only that code and itself exits 0.
    const spinner = '\u001B[?25l│\n◒  Upgrading\u001B[999D\u001B[J◐  Upgrading.\u001B[999D\u001B[J■  Upgrade failed\n';
    await opencode.set('update-stdout', `●  From 1.19.0 → 1.18.20\n${spinner}│\n■  Upgrade failed for npm (exit code 243).\n│\n└  Done\n`);

    const denied = await createService().updateCli('opencode');
    assert.equal(denied.exitCode, 0);
    assert.equal(denied.failure, 'permission_denied');
    assert.equal(denied.output, '●  From 1.19.0 → 1.18.20\n│\n■  Upgrade failed\n│\n■  Upgrade failed for npm (exit code 243).\n│\n└  Done');

    await opencode.set('update-stdout', '■  Upgrade failed\n■  Upgrade failed for npm (exit code 1).\n');
    assert.equal((await createService().updateCli('opencode')).failure, 'failed');

    // The same words after a version change are not a failure of this run.
    await opencode.set('update-new-version', '1.19.1\n');
    assert.equal((await createService().updateCli('opencode')).failure, null);
  });
});
