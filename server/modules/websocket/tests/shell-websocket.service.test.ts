import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { WebSocket } from 'ws';

import { handleShellConnection, isLoginShellCommand } from '@/modules/websocket/services/shell-websocket.service.js';

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

test('shell init launches the selected provider CLI and resumes via provider-native ids', () => {
  const spawned: Array<{ file: string; args: string[] }> = [];
  const pty = createFakePty();
  const dependencies = {
    resolveProviderSessionId: (sessionId: string, provider: string) => (
      provider === 'antigravity' ? `agy-conv-for-${sessionId}` : null
    ),
    spawnPty: (file: string, args: string | string[]) => {
      spawned.push({ file, args: Array.isArray(args) ? args : [args] });
      return pty as never;
    },
  };

  const scenarios = [
    // antigravity with a session must resume through agy's --conversation flag.
    { sessionId: `agy-resume-${Date.now()}`, provider: 'antigravity', hasSession: true, expected: (id: string) => `agy --conversation "agy-conv-for-${id}"`, expectedBanner: 'Antigravity' },
    // antigravity without a session launches a fresh interactive agy.
    { sessionId: `agy-fresh-${Date.now()}`, provider: 'antigravity', hasSession: false, expected: () => 'agy', expectedBanner: 'Antigravity' },
    // Regression guards: the previously supported providers keep their commands.
    { sessionId: `claude-resume-${Date.now()}`, provider: 'claude', hasSession: true, expected: () => 'claude --resume "claude-resume-id" || claude', expectedBanner: 'Claude' },
    { sessionId: `cursor-resume-${Date.now()}`, provider: 'cursor', hasSession: true, expected: () => 'cursor-agent --resume="cursor-resume-id"', expectedBanner: 'Cursor' },
  ] as const;

  for (const scenario of scenarios) {
    const socket = createFakeSocket();
    handleShellConnection(socket as never, {
      ...dependencies,
      resolveProviderSessionId: (sessionId: string, provider: string) => {
        if (provider === 'antigravity') return `agy-conv-for-${sessionId}`;
        if (scenario.expected('').includes('claude --resume')) return 'claude-resume-id';
        if (scenario.expected('').includes('cursor-agent')) return 'cursor-resume-id';
        return null;
      },
    });
    socket.emit(
      'message',
      JSON.stringify({
        type: 'init',
        projectPath: process.cwd(),
        sessionId: scenario.sessionId,
        hasSession: scenario.hasSession,
        provider: scenario.provider,
        isPlainShell: false,
        initialCommand: null,
      })
    );

    const shellArgs = spawned.at(-1)?.args ?? [];
    const shellCommand = shellArgs[shellArgs.indexOf('-c') + 1] ?? '';
    assert.equal(
      shellCommand,
      scenario.expected(scenario.sessionId),
      `${scenario.provider} (hasSession=${scenario.hasSession}) must launch the provider CLI`,
    );

    const frames = socket.frames.map((frame) => JSON.parse(frame) as Record<string, string>);
    const welcome = frames.find((frame) => frame.type === 'output' && typeof frame.data === 'string' && frame.data.includes('session'));
    assert.match(welcome?.data ?? '', new RegExp(scenario.expectedBanner), 'welcome banner must name the provider');

    pty.emitExit();
  }
});

test('isLoginShellCommand recognizes every provider login command', () => {
  const loginCommands = [
    'agy',
    'claude --dangerously-skip-permissions /login',
    'codex login',
    'codex login --device-auth',
    'cursor-agent login',
    'opencode auth login',
    'claude setup-token',
  ];
  for (const command of loginCommands) {
    assert.equal(isLoginShellCommand(command), true, `should match: ${command}`);
  }

  for (const command of ['claude', 'codex', 'git status', 'npm run build', '']) {
    assert.equal(isLoginShellCommand(command), false, `should not match: ${command}`);
  }
  assert.equal(isLoginShellCommand(null), false);
  assert.equal(isLoginShellCommand(undefined), false);
});

test('bypassPermissions launches claude with --dangerously-skip-permissions', () => {
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
});

test('bypassPermissions carries through to resumed claude sessions', () => {
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
});

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
