import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { findClaudeCliProcessSession } from '@/modules/providers/services/claude-cli-liveness.service.js';

// No process can have this pid on Linux, macOS or Windows.
const DEAD_PID = 2 ** 30;

/**
 * Runs `runTest` against a Claude CLI process registry holding one
 * `<pid>.json` per record, never the developer's real one.
 */
async function withRegistry(
  records: Array<Record<string, unknown> & { pid: number }>,
  runTest: () => void | Promise<void>,
): Promise<void> {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-cli-process-session-'));
  const registry = path.join(home, '.claude', 'sessions');
  fs.mkdirSync(registry, { recursive: true });
  for (const record of records) {
    fs.writeFileSync(path.join(registry, `${record.pid}.json`), JSON.stringify(record));
  }
  const realHomedir = os.homedir;
  (os as unknown as { homedir: () => string }).homedir = () => home;
  try {
    await runTest();
  } finally {
    (os as unknown as { homedir: () => string }).homedir = realHomedir;
    fs.rmSync(home, { recursive: true, force: true });
  }
}

test('a pty that execs the CLI is found by its own pid, with the session it is in now', async () => {
  await withRegistry([{ pid: process.pid, sessionId: 'after-clear' }], () => {
    assert.deepEqual(findClaudeCliProcessSession(process.pid, null), {
      pid: process.pid,
      providerSessionId: 'after-clear',
    });
  });
});

test('a known CLI pid is read first, and a stale one falls back to the pty pid', async () => {
  await withRegistry([{ pid: process.pid, sessionId: 'current' }], () => {
    assert.equal(findClaudeCliProcessSession(DEAD_PID, process.pid)?.providerSessionId, 'current');
    assert.equal(findClaudeCliProcessSession(process.pid, DEAD_PID)?.providerSessionId, 'current');
  });
});

test('dead, mismatched and incomplete registry entries are ignored', async () => {
  await withRegistry(
    [
      { pid: DEAD_PID, sessionId: 'dead' },
      { pid: process.pid, sessionId: '' },
    ],
    () => {
      assert.equal(findClaudeCliProcessSession(DEAD_PID, null), null);
      assert.equal(findClaudeCliProcessSession(process.pid, null), null);
    },
  );
});

test('a CLI the pty runs as a child process is found through its parent pid', async (t) => {
  if (process.platform === 'win32') {
    t.skip('parent pids are not read on Windows');
    return;
  }
  if (process.platform !== 'linux') {
    try {
      execFileSync('ps', ['-o', 'ppid=', '-p', String(process.pid)], { stdio: 'ignore' });
    } catch {
      t.skip('`ps` cannot run here (e.g. inside a macOS sandbox profile)');
      return;
    }
  }
  const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], { stdio: 'ignore' });
  try {
    await withRegistry(
      [
        { pid: child.pid as number, sessionId: 'child-session' },
        { pid: DEAD_PID, sessionId: 'dead' },
      ],
      () => {
        assert.deepEqual(findClaudeCliProcessSession(process.pid, null), {
          pid: child.pid,
          providerSessionId: 'child-session',
        });
        assert.equal(findClaudeCliProcessSession(DEAD_PID - 1, null), null, 'not a child of an unrelated pid');
      },
    );
  } finally {
    child.kill();
  }
});
