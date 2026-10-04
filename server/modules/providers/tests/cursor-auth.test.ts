import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test, { mock } from 'node:test';

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

async function createFakeCursorAgent(binDir: string) {
  await writeFile(path.join(binDir, 'cursor-agent.cjs'), FAKE_CURSOR_AGENT_SCRIPT, 'utf8');

  if (process.platform === 'win32') {
    const commandPath = path.join(binDir, 'cursor-agent.cmd');
    await writeFile(commandPath, '@echo off\r\nnode "%~dp0cursor-agent.cjs" %*\r\n', 'utf8');
    return;
  }

  // exec so the provider's kill() on timeout reaches the node process itself.
  const commandPath = path.join(binDir, 'cursor-agent');
  await writeFile(commandPath, '#!/bin/sh\nexec node "$(dirname "$0")/cursor-agent.cjs" "$@"\n', 'utf8');
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

const withFakeCursorAgent = async (statusOutput: string, fn: (fake: FakeCursorAgent) => Promise<void>) => {
  const binDir = await mkdtemp(path.join(os.tmpdir(), 'cursor-auth-test-'));
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

  try {
    await createFakeCursorAgent(binDir);
    await writeFile(path.join(binDir, 'status-output'), statusOutput, 'utf8');
    process.env[pathKey] = `${binDir}${path.delimiter}${previousPath || ''}`;
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
    process.env[pathKey] = previousPath;
    if (previousPathExt === undefined) {
      delete process.env[pathExtKey];
    } else {
      process.env[pathExtKey] = previousPathExt;
    }
    if (previousMarkerDir === undefined) {
      delete process.env.CURSOR_FAKE_MARKER_DIR;
    } else {
      process.env.CURSOR_FAKE_MARKER_DIR = previousMarkerDir;
    }
    await rm(binDir, { recursive: true, force: true });
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
