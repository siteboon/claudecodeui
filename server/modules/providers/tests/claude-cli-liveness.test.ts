import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { findBackgroundClaudeJobId } from '@/modules/providers/services/claude-cli-liveness.service.js';

// No process can have this pid on Linux, macOS or Windows.
const DEAD_PID = 2 ** 30;

/**
 * Runs `runTest` against a Claude CLI process registry holding exactly
 * `files` (file name -> contents), never the developer's real one.
 */
async function withRegistry(files: Record<string, unknown>, runTest: () => Promise<void>): Promise<void> {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-cli-liveness-'));
  const registry = path.join(home, '.claude', 'sessions');
  fs.mkdirSync(registry, { recursive: true });
  for (const [name, contents] of Object.entries(files)) {
    fs.writeFileSync(path.join(registry, name), typeof contents === 'string' ? contents : JSON.stringify(contents));
  }
  const realHomedir = os.homedir;
  const configDirectory = process.env.CLAUDE_CONFIG_DIR;
  delete process.env.CLAUDE_CONFIG_DIR;
  (os as unknown as { homedir: () => string }).homedir = () => home;
  try {
    await runTest();
  } finally {
    (os as unknown as { homedir: () => string }).homedir = realHomedir;
    if (configDirectory !== undefined) {
      process.env.CLAUDE_CONFIG_DIR = configDirectory;
    }
    fs.rmSync(home, { recursive: true, force: true });
  }
}

test('a live background process yields its job id for the session it holds', async () => {
  await withRegistry(
    {
      [`${process.pid}.json`]: { pid: process.pid, sessionId: 'session-bg', kind: 'bg', jobId: 'a1b2c3d4' },
    },
    async () => {
      assert.equal(await findBackgroundClaudeJobId('session-bg'), 'a1b2c3d4');
      assert.equal(await findBackgroundClaudeJobId('another-session'), null);
      assert.equal(await findBackgroundClaudeJobId(''), null);
    },
  );
});

test('interactive, dead, unsafe and malformed registry entries are not background jobs', async () => {
  await withRegistry(
    {
      'interactive.json': { pid: process.pid, sessionId: 'session-interactive', kind: 'interactive' },
      'dead.json': { pid: DEAD_PID, sessionId: 'session-dead', kind: 'bg', jobId: 'deadbeef' },
      'unsafe.json': { pid: process.pid, sessionId: 'session-unsafe', kind: 'bg', jobId: 'x"; rm -rf ~; "' },
      'no-job.json': { pid: process.pid, sessionId: 'session-no-job', kind: 'bg' },
      'broken.json': '{"pid":',
    },
    async () => {
      for (const sessionId of ['session-interactive', 'session-dead', 'session-unsafe', 'session-no-job']) {
        assert.equal(await findBackgroundClaudeJobId(sessionId), null, sessionId);
      }
    },
  );
});

test('a missing registry directory means no background jobs', async () => {
  const realHomedir = os.homedir;
  const configDirectory = process.env.CLAUDE_CONFIG_DIR;
  delete process.env.CLAUDE_CONFIG_DIR;
  (os as unknown as { homedir: () => string }).homedir = () => path.join(os.tmpdir(), 'no-such-home-for-claude-cli');
  try {
    assert.equal(await findBackgroundClaudeJobId('session-bg'), null);
  } finally {
    (os as unknown as { homedir: () => string }).homedir = realHomedir;
    if (configDirectory !== undefined) {
      process.env.CLAUDE_CONFIG_DIR = configDirectory;
    }
  }
});

// Crash leftovers named after pids that no longer exist are skipped unread,
// so they cannot hide a live job behind the per-lookup file cap.
test('a live job is found behind more stale entries than the file cap', async () => {
  const stale: Record<string, unknown> = {};
  for (let index = 0; index < 300; index += 1) {
    stale[`${DEAD_PID + index}.json`] = { pid: DEAD_PID + index, sessionId: 'session-bg', kind: 'bg', jobId: `stale${index}` };
  }
  await withRegistry(
    {
      ...stale,
      [`${process.pid}.json`]: { pid: process.pid, sessionId: 'session-bg', kind: 'bg', jobId: 'a1b2c3d4' },
    },
    async () => {
      assert.equal(await findBackgroundClaudeJobId('session-bg'), 'a1b2c3d4');
    },
  );
});

test('the registry is read from CLAUDE_CONFIG_DIR when that is set', async () => {
  const configDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-cli-config-'));
  fs.mkdirSync(path.join(configDirectory, 'sessions'));
  fs.writeFileSync(
    path.join(configDirectory, 'sessions', `${process.pid}.json`),
    JSON.stringify({ pid: process.pid, sessionId: 'session-bg', kind: 'bg', jobId: 'c0nf1gd1r' }),
  );
  await withRegistry({}, async () => {
    process.env.CLAUDE_CONFIG_DIR = configDirectory;
    try {
      assert.equal(await findBackgroundClaudeJobId('session-bg'), 'c0nf1gd1r');
    } finally {
      delete process.env.CLAUDE_CONFIG_DIR;
      fs.rmSync(configDirectory, { recursive: true, force: true });
    }
  });
});
