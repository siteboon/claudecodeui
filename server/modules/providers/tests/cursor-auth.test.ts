import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test, { mock } from 'node:test';

import spawn from 'cross-spawn';

import { CursorProviderAuth } from '@/modules/providers/list/cursor/cursor-auth.provider.js';

const findEnvKey = (name: string) =>
  Object.keys(process.env).find((key) => key.toLowerCase() === name.toLowerCase()) || name;

// What the real CLI prints when it is logged in and the account request succeeded.
const LOGGED_IN_OUTPUT = '✓ Logged in as cursor-user@example.com';

// A stand-in for the real CLI: `--version` answers at once, while `status` drops a started
// marker and keeps running (like the real one does while it fetches the account details from
// Cursor's API) until the test creates the release file, then prints the configured output.
// It records a SIGTERM so the tests can check that a timed-out check kills it.
const FAKE_CURSOR_AGENT_SCRIPT = `
const fs = require('node:fs');
const path = require('node:path');
const command = process.argv[2];
const markerDir = process.env.CURSOR_FAKE_MARKER_DIR;
if (command === '--version') {
  console.log('2026.07.20-test');
  process.exit(0);
}
if (command === 'status') {
  process.on('SIGTERM', () => {
    fs.writeFileSync(path.join(markerDir, 'status-killed'), '');
    process.exit(143);
  });
  fs.writeFileSync(path.join(markerDir, 'status-started'), '');
  // Never outlive a broken test run (its cleanup deletes the marker dir).
  const giveUpAt = Date.now() + 30000;
  const poll = () => {
    if (!fs.existsSync(markerDir) || Date.now() > giveUpAt) {
      process.exit(1);
    }
    if (fs.existsSync(path.join(markerDir, 'release-status'))) {
      process.stdout.write(fs.readFileSync(path.join(markerDir, 'status-output'), 'utf8') + '\\n');
      return;
    }
    setTimeout(poll, 20);
  };
  poll();
}
`;

// Absolute paths only: some tests run the fake with a PATH that has neither node nor dirname.
async function createFakeCursorAgent(binDir: string) {
  await mkdir(binDir, { recursive: true });
  const scriptPath = path.join(binDir, 'cursor-agent.cjs');
  await writeFile(scriptPath, FAKE_CURSOR_AGENT_SCRIPT, 'utf8');

  if (process.platform === 'win32') {
    const commandPath = path.join(binDir, 'cursor-agent.cmd');
    await writeFile(commandPath, `@echo off\r\n"${process.execPath}" "%~dp0cursor-agent.cjs" %*\r\n`, 'utf8');
    return;
  }

  // exec so the provider's kill() on timeout reaches the node process itself.
  const commandPath = path.join(binDir, 'cursor-agent');
  await writeFile(commandPath, `#!/bin/sh\nexec "${process.execPath}" "${scriptPath}" "$@"\n`, 'utf8');
  await chmod(commandPath, 0o755);
}

// Waits in real time (the tests mock only setTimeout, not setImmediate or Date) and fails
// instead of hanging when the fake never gets there.
async function waitForFile(filePath: string, description: string) {
  const giveUpAt = Date.now() + 15_000;
  while (!existsSync(filePath)) {
    if (Date.now() > giveUpAt) {
      assert.fail(`timed out waiting for ${description}`);
    }
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

type FakeCursorAgent = {
  releaseStatus: () => Promise<void>;
  waitForStatusStart: () => Promise<void>;
  waitForStatusKill: () => Promise<void>;
};

/**
 * Where the fake CLI lives: on the server's PATH (the old assumption), only in the installer's
 * ~/.local/bin with a PATH that lacks it (a systemd service, #1514), at a CURSOR_CLI_PATH outside
 * PATH, or nowhere at all.
 */
type FakeCursorAgentLocation = 'path' | 'home-local-bin' | 'cursor-cli-path' | 'nowhere';

const withFakeCursorAgent = async (
  statusOutput: string,
  fn: (fake: FakeCursorAgent) => Promise<void>,
  location: FakeCursorAgentLocation = 'path',
) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'cursor-auth-test-'));
  const homeDir = path.join(rootDir, 'home');
  const binDir = location === 'home-local-bin' ? path.join(homeDir, '.local', 'bin') : path.join(rootDir, 'bin');
  const emptyPathDir = path.join(rootDir, 'empty-path');
  const fake: FakeCursorAgent = {
    releaseStatus: () => writeFile(path.join(binDir, 'release-status'), '', 'utf8'),
    waitForStatusStart: () => waitForFile(path.join(binDir, 'status-started'), 'the fake `status` to start'),
    waitForStatusKill: () => waitForFile(path.join(binDir, 'status-killed'), 'the fake `status` to get SIGTERM'),
  };
  const pathKey = findEnvKey('PATH');
  const pathExtKey = findEnvKey('PATHEXT');
  const previousPath = process.env[pathKey];
  const previousPathExt = process.env[pathExtKey];
  const previousMarkerDir = process.env.CURSOR_FAKE_MARKER_DIR;
  const previousEnv = {
    CURSOR_CLI_PATH: process.env.CURSOR_CLI_PATH,
    HOME: process.env.HOME,
    USERPROFILE: process.env.USERPROFILE,
    LOCALAPPDATA: process.env.LOCALAPPDATA,
  };

  try {
    await mkdir(emptyPathDir, { recursive: true });
    await mkdir(homeDir, { recursive: true });
    if (location !== 'nowhere') {
      await createFakeCursorAgent(binDir);
      await writeFile(path.join(binDir, 'status-output'), statusOutput, 'utf8');
    }
    delete process.env.CURSOR_CLI_PATH;
    // os.homedir() reads HOME on POSIX and USERPROFILE on Windows.
    process.env.HOME = homeDir;
    process.env.USERPROFILE = homeDir;
    process.env.LOCALAPPDATA = path.join(homeDir, 'AppData', 'Local');
    process.env[pathKey] = location === 'path'
      ? `${binDir}${path.delimiter}${previousPath || ''}`
      : emptyPathDir;
    if (location === 'cursor-cli-path') {
      process.env.CURSOR_CLI_PATH = path.join(binDir, process.platform === 'win32' ? 'cursor-agent.cmd' : 'cursor-agent');
    }
    process.env.CURSOR_FAKE_MARKER_DIR = binDir;
    if (process.platform === 'win32') {
      process.env[pathExtKey] = previousPathExt?.toUpperCase().includes('.CMD')
        ? previousPathExt
        : `.COM;.EXE;.BAT;.CMD${previousPathExt ? `;${previousPathExt}` : ''}`;
    }

    await fn(fake);
  } finally {
    // Lets a fake `status` that is still polling exit right away.
    await fake.releaseStatus().catch(() => {});
    // Assigning undefined to process.env stores the string "undefined", so unset keys are deleted.
    const restored: [string, string | undefined][] = [
      [pathKey, previousPath],
      [pathExtKey, previousPathExt],
      ['CURSOR_FAKE_MARKER_DIR', previousMarkerDir],
      ...Object.entries(previousEnv),
    ];
    for (const [key, value] of restored) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    await rm(rootDir, { recursive: true, force: true });
  }
};

test('getStatus waits for a logged-in `cursor-agent status` that takes longer than 5 s (#551)', async () => {
  await withFakeCursorAgent(LOGGED_IN_OUTPUT, async (fake) => {
    // getStatus() arms its timeout before it spawns `status`, so it must see the mocked setTimeout.
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
      const pending = new CursorProviderAuth().getStatus();
      // Move the clock only once `status` runs, i.e. once the timeout is armed.
      await fake.waitForStatusStart();

      // CLI startup alone took 3-6 s on a busy host; the account request adds a network round trip.
      mock.timers.tick(10_000);
      await fake.releaseStatus();

      const status = await pending;
      assert.equal(status.error, undefined);
      assert.equal(status.authenticated, true);
      assert.equal(status.email, 'cursor-user@example.com');
      assert.equal(status.method, 'cli');
    } finally {
      mock.timers.reset();
    }
  });
});

test('getStatus still gives up on, and kills, a `cursor-agent status` that never answers', async () => {
  await withFakeCursorAgent(LOGGED_IN_OUTPUT, async (fake) => {
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
      const pending = new CursorProviderAuth().getStatus();
      await fake.waitForStatusStart();

      mock.timers.tick(60_000);

      const status = await pending;
      assert.equal(status.installed, true);
      assert.equal(status.authenticated, false);
      assert.equal(status.error, 'Command timeout');
      // On Windows kill() ends the .cmd shim's cmd.exe, which does not signal node behind it.
      if (process.platform !== 'win32') {
        await fake.waitForStatusKill();
      }
    } finally {
      mock.timers.reset();
    }
  });
});

test('getStatus reports no email when `cursor-agent status` could not fetch the account', async () => {
  // What the real CLI prints when its account request fails: the stored login is still valid.
  const output = '✓ Login successful!\nLogged in (unable to fetch user details)';
  await withFakeCursorAgent(output, async (fake) => {
    await fake.releaseStatus();

    const status = await new CursorProviderAuth().getStatus();
    assert.equal(status.error, undefined);
    assert.equal(status.authenticated, true);
    // The old 'Logged in' placeholder made the Settings card read "Logged in as Logged in".
    assert.equal(status.email, null);
    assert.equal(status.method, 'cli');
  });
});

test('getStatus finds a Cursor CLI that is only in ~/.local/bin, outside the server PATH (#1514)', {
  // On Windows the installer folder is %LOCALAPPDATA%\cursor-agent; the resolver tests cover it.
  skip: process.platform === 'win32' ? 'POSIX install layout' : false,
}, async () => {
  await withFakeCursorAgent(LOGGED_IN_OUTPUT, async (fake) => {
    await fake.releaseStatus();

    const status = await new CursorProviderAuth().getStatus();
    assert.equal(status.installed, true);
    assert.equal(status.error, undefined);
    assert.equal(status.authenticated, true);
    assert.equal(status.email, 'cursor-user@example.com');
  }, 'home-local-bin');
});

test('getStatus runs the Cursor CLI that CURSOR_CLI_PATH points at', async () => {
  await withFakeCursorAgent(LOGGED_IN_OUTPUT, async (fake) => {
    await fake.releaseStatus();

    const status = await new CursorProviderAuth().getStatus();
    assert.equal(status.installed, true);
    assert.equal(status.error, undefined);
    assert.equal(status.authenticated, true);
    assert.equal(status.email, 'cursor-user@example.com');
  }, 'cursor-cli-path');
});

test('getStatus reports a missing Cursor CLI as not installed and says where it looked', async () => {
  await withFakeCursorAgent(LOGGED_IN_OUTPUT, async () => {
    const status = await new CursorProviderAuth().getStatus();
    // cross-spawn's sync spawn returns ENOENT instead of throwing, which used to read as installed.
    assert.equal(status.installed, false);
    assert.equal(status.authenticated, false);
    assert.match(status.error ?? '', /^Cursor CLI not found\. Looked for cursor-agent on the server's PATH \(/);
    assert.ok(status.error?.includes(process.env[findEnvKey('PATH')] ?? '<no PATH>'), status.error);
    assert.ok(status.error?.includes('CURSOR_CLI_PATH'), status.error);
    if (process.platform !== 'win32') {
      assert.ok(status.error?.includes(path.join(os.homedir(), '.local', 'bin', 'cursor-agent')), status.error);
    }
  }, 'nowhere');
});

// ---------------------------

const posixOnly = { skip: process.platform === 'win32' ? 'POSIX file modes and errno values' : false };

const notRunnableMessage = (cliPath: string) =>
  `Cursor CLI not found: CURSOR_CLI_PATH points to "${cliPath}", which cannot be run.`;

test('getStatus reports a CURSOR_CLI_PATH file without the execute bit as not installed (EACCES)', posixOnly, async () => {
  await withFakeCursorAgent(LOGGED_IN_OUTPUT, async () => {
    // HOME is the test's temp folder here.
    const notExecutable = path.join(os.homedir(), 'cursor-agent');
    await writeFile(notExecutable, '#!/bin/sh\nexit 0\n', 'utf8');
    await chmod(notExecutable, 0o644);
    process.env.CURSOR_CLI_PATH = notExecutable;

    const status = await new CursorProviderAuth().getStatus();
    assert.equal(status.installed, false);
    assert.equal(status.authenticated, false);
    assert.ok(status.error?.startsWith(notRunnableMessage(notExecutable)), status.error);
  }, 'nowhere');
});

test('getStatus reports any other CURSOR_CLI_PATH the OS cannot start (ENOTDIR, ELOOP) as not installed', posixOnly, async () => {
  await withFakeCursorAgent(LOGGED_IN_OUTPUT, async () => {
    const home = os.homedir();
    const regularFile = path.join(home, 'notes.txt');
    await writeFile(regularFile, '', 'utf8');
    const loopA = path.join(home, 'loop-a');
    const loopB = path.join(home, 'loop-b');
    await symlink(loopB, loopA);
    await symlink(loopA, loopB);

    // ENOTDIR: a path "inside" a regular file. ELOOP: a symlink cycle.
    for (const cliPath of [path.join(regularFile, 'cursor-agent'), loopA]) {
      process.env.CURSOR_CLI_PATH = cliPath;
      const status = await new CursorProviderAuth().getStatus();
      assert.equal(status.installed, false, cliPath);
      assert.ok(status.error?.startsWith(notRunnableMessage(cliPath)), status.error);
    }
  }, 'nowhere');
});

test('getStatus reports a Cursor CLI in ~/.local/bin that the OS cannot start as not installed', posixOnly, async () => {
  await withFakeCursorAgent(LOGGED_IN_OUTPUT, async () => {
    // The resolver accepts any executable file there; a missing interpreter makes the spawn fail
    // with ENOENT, the same code as a CLI that is not there at all.
    const brokenCli = path.join(os.homedir(), '.local', 'bin', 'cursor-agent');
    await mkdir(path.dirname(brokenCli), { recursive: true });
    await writeFile(brokenCli, '#!/nonexistent/interpreter\nexit 0\n', 'utf8');
    await chmod(brokenCli, 0o755);

    const status = await new CursorProviderAuth().getStatus();
    assert.equal(status.installed, false);
    assert.equal(status.authenticated, false);
    assert.equal(
      status.error,
      `Cursor CLI "${brokenCli}" was found but could not be started. `
        + 'Reinstall it, or set CURSOR_CLI_PATH to a working cursor-agent executable.',
    );
  }, 'nowhere');
});

test('getStatus still counts a Cursor CLI whose `--version` timed out as installed', async () => {
  await withFakeCursorAgent(LOGGED_IN_OUTPUT, async (fake) => {
    await fake.releaseStatus();
    // What cross-spawn returns when the 5 s `--version` probe is killed: the CLI started, it was slow.
    const timedOut = Object.assign(new Error('spawnSync cursor-agent ETIMEDOUT'), { code: 'ETIMEDOUT' });
    const versionProbe = mock.method(spawn, 'sync', () => ({
      pid: 1,
      output: [],
      stdout: Buffer.alloc(0),
      stderr: Buffer.alloc(0),
      status: null,
      signal: 'SIGTERM' as const,
      error: timedOut,
    }));
    try {
      const status = await new CursorProviderAuth().getStatus();
      assert.equal(versionProbe.mock.callCount(), 1);
      assert.equal(status.installed, true);
      assert.equal(status.error, undefined);
      assert.equal(status.authenticated, true);
    } finally {
      versionProbe.mock.restore();
    }
  });
});
