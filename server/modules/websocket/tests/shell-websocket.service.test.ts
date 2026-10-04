import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { WebSocket } from 'ws';

import { handleShellConnection } from '@/modules/websocket/services/shell-websocket.service.js';
import { CLAUDE_ROOT_BYPASS_NOTICE, CLAUDE_ROOT_BYPASS_NOTICE_CODE } from '@/shared/utils.js';

const SANDBOX_ENV_KEYS = ['IS_SANDBOX', 'CLAUDE_CODE_BUBBLEWRAP'] as const;

/**
 * Runs `body` as if the server process had `uid`, with Claude Code's sandbox
 * markers (`IS_SANDBOX`, `CLAUDE_CODE_BUBBLEWRAP`) set only as given and an
 * empty HOME holding only `userSettingsEnv` as `~/.claude/settings.json`'s
 * `env`, so the bypass tests do not depend on who runs the suite.
 */
function withProcessIdentity(
  uid: number,
  sandboxEnv: Partial<Record<(typeof SANDBOX_ENV_KEYS)[number], string>>,
  body: () => void,
  userSettingsEnv?: Record<string, string>,
): void {
  const originalGetuid = process.getuid;
  const originalEnv = Object.fromEntries(
    [...SANDBOX_ENV_KEYS, 'HOME', 'CLAUDE_CONFIG_DIR'].map((key) => [key, process.env[key]]),
  );
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'shell-bypass-home-'));
  if (userSettingsEnv) {
    fs.mkdirSync(path.join(home, '.claude'));
    fs.writeFileSync(path.join(home, '.claude', 'settings.json'), JSON.stringify({ env: userSettingsEnv }));
  }
  process.env.HOME = home;
  delete process.env.CLAUDE_CONFIG_DIR;
  process.getuid = () => uid;
  for (const key of SANDBOX_ENV_KEYS) {
    if (sandboxEnv[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = sandboxEnv[key];
    }
  }

  try {
    body();
  } finally {
    process.getuid = originalGetuid;
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    fs.rmSync(home, { recursive: true, force: true });
  }
}

type ShellLaunch = {
  command: string;
  output: string;
  /** `notice` frames, which the Shell draws outside the terminal. */
  notices: unknown[];
  /** Opens a second socket onto the same PTY session and returns its `notice` frames. */
  reconnectNotices: () => unknown[];
};

const NOTICE_FRAME = { type: 'notice', code: CLAUDE_ROOT_BYPASS_NOTICE_CODE };

/** Starts a claude shell (bypass requested unless told otherwise) and returns what it spawned and sent. */
function launchClaudeShellWithBypass(
  options: { resumeSessionId?: string; bypassPermissions?: boolean; provider?: string } = {},
): ShellLaunch {
  const spawnedCommands: string[] = [];
  const dependencies = {
    resolveProviderSessionId: () => options.resumeSessionId ?? null,
    spawnPty: (_shell: string, args: string | string[]) => {
      spawnedCommands.push(Array.isArray(args) ? args[args.length - 1] : args);
      return createFakePty() as never;
    },
  };

  const initMessage = JSON.stringify({
    type: 'init',
    projectPath: process.cwd(),
    sessionId: `bypass-identity-${Date.now()}-${Math.random()}`,
    hasSession: Boolean(options.resumeSessionId),
    provider: options.provider ?? 'claude',
    bypassPermissions: options.bypassPermissions ?? true,
  });
  const socket = createFakeSocket();
  handleShellConnection(socket as never, dependencies);
  socket.emit('message', initMessage);

  assert.equal(spawnedCommands.length, 1);
  const frames = socket.frames.map((frame) => JSON.parse(frame) as { type?: string; data?: string });
  const output = frames
    .filter((frame) => frame.type === 'output')
    .map((frame) => frame.data ?? '')
    .join('');
  const noticesOf = (sent: Array<{ type?: string }>) => sent.filter((frame) => frame.type === 'notice');
  const reconnectNotices = () => {
    const replacement = createFakeSocket();
    handleShellConnection(replacement as never, dependencies);
    replacement.emit('message', initMessage);
    assert.equal(spawnedCommands.length, 1, 'a reconnect must reuse the running PTY');
    return noticesOf(replacement.frames.map((frame) => JSON.parse(frame) as { type?: string }));
  };
  return { command: spawnedCommands[0], output, notices: noticesOf(frames), reconnectNotices };
}

function createFakeSocket() {
  const socket = new EventEmitter() as EventEmitter & {
    readyState: number;
    frames: string[];
    send: (data: string) => void;
  };
  socket.readyState = WebSocket.OPEN;
  socket.frames = [];
  socket.send = (data: string) => socket.frames.push(data);
  return socket;
}

function createFakePty() {
  let dataListener: ((data: string) => void) | null = null;
  let exitListener: ((event: { exitCode: number; signal?: number }) => void) | null = null;

  return {
    killed: false,
    onData(listener: (data: string) => void) {
      dataListener = listener;
      return { dispose: () => undefined };
    },
    onExit(listener: (event: { exitCode: number; signal?: number }) => void) {
      exitListener = listener;
      return { dispose: () => undefined };
    },
    emitData(data: string) {
      dataListener?.(data);
    },
    emitExit() {
      exitListener?.({ exitCode: 0 });
    },
    write() {},
    resize() {},
    kill() {
      this.killed = true;
    },
  };
}

test('a stale socket close cannot detach the socket that replaced it', () => {
  const pty = createFakePty();
  const dependencies = {
    resolveProviderSessionId: () => null,
    spawnPty: () => pty as never,
  };
  const initMessage = JSON.stringify({
    type: 'init',
    projectPath: process.cwd(),
    sessionId: `stale-close-${Date.now()}`,
    hasSession: false,
    provider: 'plain-shell',
    isPlainShell: true,
    initialCommand: 'test-command',
  });

  const firstSocket = createFakeSocket();
  handleShellConnection(firstSocket as never, dependencies);
  firstSocket.emit('message', initMessage);

  const replacementSocket = createFakeSocket();
  handleShellConnection(replacementSocket as never, dependencies);
  replacementSocket.emit('message', initMessage);
  replacementSocket.frames.length = 0;

  // This ordering reproduces a delayed close from a backgrounded mobile tab.
  firstSocket.emit('close');
  pty.emitData('output-after-stale-close');

  assert.equal(pty.killed, false);
  assert.equal(replacementSocket.frames.length, 1);
  assert.match(replacementSocket.frames[0], /output-after-stale-close/);

  pty.emitExit();
});

test('shell output detects and normalizes a wrapped authentication URL', () => {
  const pty = createFakePty();
  const socket = createFakeSocket();
  const dependencies = {
    resolveProviderSessionId: () => null,
    spawnPty: () => pty as never,
  };

  handleShellConnection(socket as never, dependencies);
  socket.emit(
    'message',
    JSON.stringify({
      type: 'init',
      projectPath: process.cwd(),
      sessionId: `wrapped-url-${Date.now()}`,
      hasSession: false,
      provider: 'plain-shell',
      isPlainShell: true,
      initialCommand: 'test-command',
    })
  );
  socket.frames.length = 0;

  pty.emitData("Continue in your browser: https://example.com/authorize?\ncode=abc\x1b[0m");

  const frames = socket.frames.map((frame) => JSON.parse(frame) as Record<string, unknown>);
  const authenticationFrame = frames.find((frame) => frame.type === 'auth_url');
  assert.deepEqual(authenticationFrame, {
    type: 'auth_url',
    url: 'https://example.com/authorize?code=abc',
    autoOpen: false,
  });

  pty.emitExit();
});

test('bypassPermissions launches claude with --dangerously-skip-permissions', () => withProcessIdentity(1000, {}, () => {
  const spawnedCommands: string[] = [];
  const dependencies = {
    resolveProviderSessionId: () => null,
    spawnPty: (_shell: string, args: string | string[]) => {
      spawnedCommands.push(Array.isArray(args) ? args[args.length - 1] : args);
      return createFakePty() as never;
    },
  };

  const bypassSocket = createFakeSocket();
  handleShellConnection(bypassSocket as never, dependencies);
  bypassSocket.emit(
    'message',
    JSON.stringify({
      type: 'init',
      projectPath: process.cwd(),
      sessionId: `bypass-on-${Date.now()}`,
      hasSession: false,
      provider: 'claude',
      bypassPermissions: true,
    })
  );

  const defaultSocket = createFakeSocket();
  handleShellConnection(defaultSocket as never, dependencies);
  defaultSocket.emit(
    'message',
    JSON.stringify({
      type: 'init',
      projectPath: process.cwd(),
      sessionId: `bypass-off-${Date.now()}`,
      hasSession: false,
      provider: 'claude',
    })
  );

  assert.deepEqual(spawnedCommands, ['claude --dangerously-skip-permissions', 'claude']);
}));

test('bypassPermissions carries through to resumed claude sessions', () => withProcessIdentity(1000, {}, () => {
  const spawnedCommands: string[] = [];
  const dependencies = {
    resolveProviderSessionId: () => 'resumed-session-id',
    spawnPty: (_shell: string, args: string | string[]) => {
      spawnedCommands.push(Array.isArray(args) ? args[args.length - 1] : args);
      return createFakePty() as never;
    },
  };

  const socket = createFakeSocket();
  handleShellConnection(socket as never, dependencies);
  socket.emit(
    'message',
    JSON.stringify({
      type: 'init',
      projectPath: process.cwd(),
      sessionId: `bypass-resume-${Date.now()}`,
      hasSession: true,
      provider: 'claude',
      bypassPermissions: true,
    })
  );

  assert.equal(spawnedCommands.length, 1);
  if (os.platform() !== 'win32') {
    assert.equal(
      spawnedCommands[0],
      'claude --resume "resumed-session-id" --dangerously-skip-permissions || claude --dangerously-skip-permissions'
    );
  }
}));

// Claude Code exits with code 1 on --dangerously-skip-permissions when it runs
// as root outside a deliberate sandbox (#641), so the Shell tab must not ask
// for it there.
test('as root, a bypass launch starts claude without the flag and says why', () => withProcessIdentity(0, {}, () => {
  const fresh = launchClaudeShellWithBypass();
  assert.equal(fresh.command, 'claude');
  assert.ok(fresh.output.includes(CLAUDE_ROOT_BYPASS_NOTICE), fresh.output);
  // The CLI's full-screen UI clears the terminal, so the Shell is also told
  // outside it, and told again when it reattaches to the running session.
  assert.deepEqual(fresh.notices, [NOTICE_FRAME]);
  assert.deepEqual(fresh.reconnectNotices(), [NOTICE_FRAME]);

  if (os.platform() !== 'win32') {
    const resumed = launchClaudeShellWithBypass({ resumeSessionId: 'resumed-as-root' });
    assert.equal(resumed.command, 'claude --resume "resumed-as-root" || claude');
    assert.ok(resumed.output.includes(CLAUDE_ROOT_BYPASS_NOTICE), resumed.output);
    assert.deepEqual(resumed.notices, [NOTICE_FRAME]);
  }
}));

test('as root, a launch that did not ask for bypass gets no notice', () => withProcessIdentity(0, {}, () => {
  const launch = launchClaudeShellWithBypass({ bypassPermissions: false });
  assert.equal(launch.command, 'claude');
  assert.ok(!launch.output.includes(CLAUDE_ROOT_BYPASS_NOTICE), launch.output);
  assert.deepEqual(launch.notices, []);
  assert.deepEqual(launch.reconnectNotices(), []);

  // Other agents' shells never carry the Claude flag, so nothing was dropped.
  const cursor = launchClaudeShellWithBypass({ provider: 'cursor' });
  assert.equal(cursor.command, 'cursor-agent');
  assert.deepEqual(cursor.notices, []);
}));

test('as root inside a sandbox Claude Code accepts, the bypass flag is kept', () => {
  for (const sandboxEnv of [
    { IS_SANDBOX: '1' },
    { CLAUDE_CODE_BUBBLEWRAP: '1' },
    { CLAUDE_CODE_BUBBLEWRAP: ' Yes ' },
    { CLAUDE_CODE_BUBBLEWRAP: 'on' },
  ]) {
    withProcessIdentity(0, sandboxEnv, () => {
      const launch = launchClaudeShellWithBypass();
      assert.equal(launch.command, 'claude --dangerously-skip-permissions', JSON.stringify(sandboxEnv));
      assert.ok(!launch.output.includes(CLAUDE_ROOT_BYPASS_NOTICE));
      assert.deepEqual(launch.notices, []);
    });
  }

  // Claude Code also reads the markers from the env block of its user settings.
  withProcessIdentity(0, {}, () => {
    const launch = launchClaudeShellWithBypass();
    assert.equal(launch.command, 'claude --dangerously-skip-permissions');
    assert.deepEqual(launch.notices, []);
  }, { IS_SANDBOX: '1' });

  // Only the exact values the CLI honours count as a sandbox.
  for (const sandboxEnv of [{ IS_SANDBOX: 'true' }, { CLAUDE_CODE_BUBBLEWRAP: '0' }]) {
    withProcessIdentity(0, sandboxEnv, () => {
      assert.equal(launchClaudeShellWithBypass().command, 'claude', JSON.stringify(sandboxEnv));
    });
  }
});

test('a non-root server keeps the bypass flag and prints no notice', () => withProcessIdentity(1000, {}, () => {
  const launch = launchClaudeShellWithBypass();
  assert.equal(launch.command, 'claude --dangerously-skip-permissions');
  assert.ok(!launch.output.includes(CLAUDE_ROOT_BYPASS_NOTICE));
  assert.deepEqual(launch.notices, []);
}));

test('a missing project directory is reported as an error frame and starts no pty', () => {
  const socket = createFakeSocket();
  let spawnCount = 0;
  const dependencies = {
    resolveProviderSessionId: () => null,
    spawnPty: () => {
      spawnCount += 1;
      return createFakePty() as never;
    },
  };

  handleShellConnection(socket as never, dependencies);
  socket.emit(
    'message',
    JSON.stringify({
      type: 'init',
      // A project row survives its directory being deleted or unmounted, so
      // this is what the Shell tab sends for a stale sidebar entry.
      projectPath: path.join(os.tmpdir(), `shell-missing-${Date.now()}`),
      sessionId: `missing-path-${Date.now()}`,
      hasSession: false,
      provider: 'plain-shell',
      isPlainShell: true,
    })
  );

  assert.equal(spawnCount, 0);
  assert.deepEqual(
    socket.frames.map((frame) => JSON.parse(frame) as Record<string, unknown>),
    [{ type: 'error', message: 'Invalid project path' }]
  );
});
