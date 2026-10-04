import assert from 'node:assert/strict';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test, { mock } from 'node:test';

import { CursorProviderAuth } from '@/modules/providers/list/cursor/cursor-auth.provider.js';

const findEnvKey = (name: string) =>
  Object.keys(process.env).find((key) => key.toLowerCase() === name.toLowerCase()) || name;

// A stand-in for the real CLI: `--version` answers at once, while `status` keeps running
// (like the real one does while it confirms the stored login with Cursor's API) until the
// test creates the release file, then prints the real CLI's logged-in line.
const FAKE_CURSOR_AGENT_SCRIPT = `
const fs = require('node:fs');
const command = process.argv[2];
if (command === '--version') {
  console.log('2026.07.20-test');
  process.exit(0);
}
if (command === 'status') {
  const releasePath = process.env.CURSOR_STATUS_RELEASE_FILE;
  // Never outlive a broken test run.
  const giveUpAt = Date.now() + 30000;
  const poll = () => {
    if (fs.existsSync(releasePath) || Date.now() > giveUpAt) {
      console.log('\\u2713 Logged in as cursor-user@example.com');
      process.exit(0);
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

const withFakeCursorAgent = async (fn: (releaseStatus: () => Promise<void>) => Promise<void>) => {
  const binDir = await mkdtemp(path.join(os.tmpdir(), 'cursor-auth-test-'));
  const releasePath = path.join(binDir, 'release-status');
  const releaseStatus = () => writeFile(releasePath, '', 'utf8');
  const pathKey = findEnvKey('PATH');
  const pathExtKey = findEnvKey('PATHEXT');
  const previousPath = process.env[pathKey];
  const previousPathExt = process.env[pathExtKey];
  const previousReleasePath = process.env.CURSOR_STATUS_RELEASE_FILE;

  try {
    await createFakeCursorAgent(binDir);
    process.env[pathKey] = `${binDir}${path.delimiter}${previousPath || ''}`;
    process.env.CURSOR_STATUS_RELEASE_FILE = releasePath;
    if (process.platform === 'win32') {
      process.env[pathExtKey] = previousPathExt?.toUpperCase().includes('.CMD')
        ? previousPathExt
        : `.COM;.EXE;.BAT;.CMD${previousPathExt ? `;${previousPathExt}` : ''}`;
    }

    await fn(releaseStatus);
  } finally {
    // Lets a fake `status` that is still polling exit right away.
    await releaseStatus().catch(() => {});
    process.env[pathKey] = previousPath;
    if (previousPathExt === undefined) {
      delete process.env[pathExtKey];
    } else {
      process.env[pathExtKey] = previousPathExt;
    }
    if (previousReleasePath === undefined) {
      delete process.env.CURSOR_STATUS_RELEASE_FILE;
    } else {
      process.env.CURSOR_STATUS_RELEASE_FILE = previousReleasePath;
    }
    await rm(binDir, { recursive: true, force: true });
  }
};

test('getStatus waits for a logged-in `cursor-agent status` that takes longer than 5 s (#551)', async () => {
  await withFakeCursorAgent(async (releaseStatus) => {
    // getStatus() arms its timeout synchronously, so it must see the mocked setTimeout.
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
      const pending = new CursorProviderAuth().getStatus();

      // CLI startup alone took 3-6 s on a busy host; the login check adds a network round trip.
      mock.timers.tick(10_000);
      await releaseStatus();

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

test('getStatus still gives up on a `cursor-agent status` that never answers', async () => {
  await withFakeCursorAgent(async () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
      const pending = new CursorProviderAuth().getStatus();

      mock.timers.tick(60_000);

      const status = await pending;
      assert.equal(status.installed, true);
      assert.equal(status.authenticated, false);
      assert.equal(status.error, 'Command timeout');
    } finally {
      mock.timers.reset();
    }
  });
});
