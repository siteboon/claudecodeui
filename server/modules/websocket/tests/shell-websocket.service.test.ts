import assert from 'node:assert/strict';
import os from 'node:os';
import test from 'node:test';

import {
  buildPtySessionKey,
  buildShellCommand,
} from '@/modules/websocket/services/shell-websocket.service.js';

const noopDependencies = {
  getSessionById: () => null,
  stripAnsiSequences: (content: string) => content,
  normalizeDetectedUrl: () => null,
  extractUrlsFromText: () => [],
  shouldAutoOpenUrlFromOutput: () => false,
};

/** Pin os.platform() for the duration of a test, then restore. */
function withPlatform(platform: NodeJS.Platform, run: () => void): void {
  const original = os.platform;
  (os as any).platform = () => platform;
  try {
    run();
  } finally {
    (os as any).platform = original;
  }
}

/** Pin process.env.SHELL for the duration of a test, then restore. */
function withShell(shell: string | undefined, run: () => void): void {
  const original = process.env.SHELL;
  if (shell === undefined) {
    delete process.env.SHELL;
  } else {
    process.env.SHELL = shell;
  }
  try {
    run();
  } finally {
    if (original === undefined) {
      delete process.env.SHELL;
    } else {
      process.env.SHELL = original;
    }
  }
}

test('buildShellCommand: plain shell with no command opens an interactive login shell', () => {
  withPlatform('linux', () => {
    withShell('/bin/zsh', () => {
      const command = buildShellCommand({ isPlainShell: true }, noopDependencies);
      assert.equal(command, 'exec "/bin/zsh" -il');
    });
  });
});

test('buildShellCommand: plain shell falls back to bash when SHELL is unset', () => {
  withPlatform('linux', () => {
    withShell(undefined, () => {
      const command = buildShellCommand({ isPlainShell: true }, noopDependencies);
      assert.equal(command, 'exec "bash" -il');
    });
  });
});

test('buildShellCommand: plain shell with a command runs that command verbatim', () => {
  const command = buildShellCommand(
    { isPlainShell: true, initialCommand: 'npm run build' },
    noopDependencies
  );
  assert.equal(command, 'npm run build');
});

test('buildShellCommand: provider "plain-shell" is treated as a plain shell', () => {
  withPlatform('linux', () => {
    withShell('/bin/bash', () => {
      const command = buildShellCommand({ provider: 'plain-shell' }, noopDependencies);
      assert.equal(command, 'exec "/bin/bash" -il');
    });
  });
});

test('buildShellCommand: a command without a session is treated as a plain shell', () => {
  const command = buildShellCommand(
    { initialCommand: 'ls -la', hasSession: false },
    noopDependencies
  );
  assert.equal(command, 'ls -la');
});

test('buildShellCommand: agent providers are unaffected by the plain-shell toggle', () => {
  // Guards that adding the toggle did not divert the non-plain agent paths.
  assert.equal(buildShellCommand({ provider: 'cursor' }, noopDependencies), 'cursor-agent');
  assert.equal(buildShellCommand({ provider: 'opencode' }, noopDependencies), 'opencode');
});

test('buildPtySessionKey: plain and agent shells with no session get distinct keys', () => {
  // The toggle bug: both resolve sessionId -> "default", so without the mode
  // prefix the keys collide and the wrong pty is reused.
  const plainKey = buildPtySessionKey({
    projectPath: '/proj',
    isPlainShell: true,
    provider: 'claude',
    sessionId: null,
    initialCommand: '',
  });
  const agentKey = buildPtySessionKey({
    projectPath: '/proj',
    isPlainShell: false,
    provider: 'claude',
    sessionId: null,
    initialCommand: '',
  });

  assert.equal(plainKey, '/proj_plain_default');
  assert.equal(agentKey, '/proj_claude_default');
  assert.notEqual(plainKey, agentKey);
});

test('buildPtySessionKey: distinct agent providers get distinct keys', () => {
  const claude = buildPtySessionKey({
    projectPath: '/proj',
    isPlainShell: false,
    provider: 'claude',
    sessionId: null,
    initialCommand: '',
  });
  const cursor = buildPtySessionKey({
    projectPath: '/proj',
    isPlainShell: false,
    provider: 'cursor',
    sessionId: null,
    initialCommand: '',
  });
  assert.notEqual(claude, cursor);
});

test('buildPtySessionKey: a concrete sessionId is used in the key', () => {
  const key = buildPtySessionKey({
    projectPath: '/proj',
    isPlainShell: false,
    provider: 'claude',
    sessionId: 'abc123',
    initialCommand: '',
  });
  assert.equal(key, '/proj_claude_abc123');
});

test('buildPtySessionKey: a plain shell command adds a command suffix', () => {
  const suffix = `_cmd_${Buffer.from('npm test').toString('base64').slice(0, 16)}`;
  const key = buildPtySessionKey({
    projectPath: '/proj',
    isPlainShell: true,
    provider: 'claude',
    sessionId: null,
    initialCommand: 'npm test',
  });
  assert.equal(key, `/proj_plain_default${suffix}`);
});

test('buildPtySessionKey: an agent command does not add a command suffix', () => {
  const key = buildPtySessionKey({
    projectPath: '/proj',
    isPlainShell: false,
    provider: 'claude',
    sessionId: null,
    initialCommand: 'claude --resume',
  });
  assert.equal(key, '/proj_claude_default');
});
