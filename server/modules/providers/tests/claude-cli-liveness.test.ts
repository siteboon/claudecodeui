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
function withRegistry(files: Record<string, unknown>, runTest: () => void): void {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-cli-liveness-'));
  const registry = path.join(home, '.claude', 'sessions');
  fs.mkdirSync(registry, { recursive: true });
  for (const [name, contents] of Object.entries(files)) {
    fs.writeFileSync(path.join(registry, name), typeof contents === 'string' ? contents : JSON.stringify(contents));
  }
  const realHomedir = os.homedir;
  (os as unknown as { homedir: () => string }).homedir = () => home;
  try {
    runTest();
  } finally {
    (os as unknown as { homedir: () => string }).homedir = realHomedir;
    fs.rmSync(home, { recursive: true, force: true });
  }
}

test('a live background process yields its job id for the session it holds', () => {
  withRegistry(
    {
      [`${process.pid}.json`]: { pid: process.pid, sessionId: 'session-bg', kind: 'bg', jobId: 'a1b2c3d4' },
    },
    () => {
      assert.equal(findBackgroundClaudeJobId('session-bg'), 'a1b2c3d4');
      assert.equal(findBackgroundClaudeJobId('another-session'), null);
      assert.equal(findBackgroundClaudeJobId(''), null);
    },
  );
});

test('interactive, dead, unsafe and malformed registry entries are not background jobs', () => {
  withRegistry(
    {
      'interactive.json': { pid: process.pid, sessionId: 'session-interactive', kind: 'interactive' },
      'dead.json': { pid: DEAD_PID, sessionId: 'session-dead', kind: 'bg', jobId: 'deadbeef' },
      'unsafe.json': { pid: process.pid, sessionId: 'session-unsafe', kind: 'bg', jobId: 'x"; rm -rf ~; "' },
      'no-job.json': { pid: process.pid, sessionId: 'session-no-job', kind: 'bg' },
      'broken.json': '{"pid":',
    },
    () => {
      for (const sessionId of ['session-interactive', 'session-dead', 'session-unsafe', 'session-no-job']) {
        assert.equal(findBackgroundClaudeJobId(sessionId), null, sessionId);
      }
    },
  );
});

test('a missing registry directory means no background jobs', () => {
  const realHomedir = os.homedir;
  (os as unknown as { homedir: () => string }).homedir = () => path.join(os.tmpdir(), 'no-such-home-for-claude-cli');
  try {
    assert.equal(findBackgroundClaudeJobId('session-bg'), null);
  } finally {
    (os as unknown as { homedir: () => string }).homedir = realHomedir;
  }
});
