import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, rmdirSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { WebSocket } from 'ws';
import nodePty from 'node-pty';

import { handleShellConnection } from '@/modules/websocket/services/shell-websocket.service.js';

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

test('ending a real PTY releases a writer lock, while disconnect preserves it', {
  skip: os.platform() !== 'linux' || spawnSync('flock', ['--version']).status !== 0,
  timeout: 10000,
}, async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'cloudcli-terminal-lock-'));
  const lock = path.join(directory, 'writer.lock');
  const socket = createFakeSocket();
  let terminal: ReturnType<typeof nodePty.spawn> | undefined;
  const dependencies = {
    resolveProviderSessionId: () => 'lock-test-thread',
    spawnPty: (() => {
      // --no-fork mirrors exec codex: the process owning the PTY holds the lock.
      terminal = nodePty.spawn('flock', ['--no-fork', lock, 'sleep', '60'], {});
      return terminal;
    }) as typeof nodePty.spawn,
  };
  const init = JSON.stringify({ type: 'init', projectPath: directory,
    sessionId: directory.split(path.sep).pop(), hasSession: true, provider: 'codex' });
  const isLocked = () => spawnSync('flock', ['-n', lock, 'true']).status === 1;
  try {
    handleShellConnection(socket as never, dependencies);
    socket.emit('message', init);
    for (let i = 0; i < 100 && !isLocked(); i++) await delay(20);
    assert.equal(isLocked(), true);
    socket.emit('close');
    assert.equal(isLocked(), true);
    const replacement = createFakeSocket();
    handleShellConnection(replacement as never, dependencies);
    replacement.emit('message', init);
    replacement.emit('message', JSON.stringify({ type: 'terminate' }));
    for (let i = 0; i < 100 && !replacement.frames.some((frame) => JSON.parse(frame).type === 'terminated'); i++) await delay(20);
    assert.equal(replacement.frames.some((frame) => JSON.parse(frame).type === 'terminated'), true);
    assert.equal(isLocked(), false);
  } finally {
    try { terminal?.kill(); } catch { /* Already exited. */ }
    rmSync(lock, { force: true });
    // The directory contains only the test's lock file.
    rmdirSync(directory);
  }
});

test('ending a Codex terminal stops its writer without a fallback conversation', () => {
  const terminal = createFakePty();
  const socket = createFakeSocket();
  let command = '';
  handleShellConnection(socket as never, {
    resolveProviderSessionId: () => 'test-codex-thread',
    spawnPty: ((_shell: string, args: string[]) => {
      command = args.join(' ');
      return terminal as never;
    }) as never,
  });
  socket.emit('message', JSON.stringify({
    type: 'init', projectPath: process.cwd(), sessionId: 'terminate-codex',
    hasSession: true, provider: 'codex',
  }));
  assert.match(command, /codex resume "test-codex-thread"/);
  assert.doesNotMatch(command, /\|\||LASTEXITCODE/);
  if (os.platform() !== 'win32') assert.match(command, /exec codex resume/);
  socket.emit('message', JSON.stringify({ type: 'terminate' }));
  assert.equal(terminal.killed, true);
  assert.equal(socket.frames.some((frame) => JSON.parse(frame).type === 'terminated'), false);
  terminal.emitExit();
  assert.equal(socket.frames.some((frame) => JSON.parse(frame).type === 'terminated'), true);
  socket.emit('close');
});

test('disconnect preserves a terminal but only its current socket may terminate it', () => {
  const terminal = createFakePty();
  const dependencies = {
    resolveProviderSessionId: () => 'test-thread',
    spawnPty: () => terminal as never,
  };
  const init = JSON.stringify({ type: 'init', projectPath: process.cwd(),
    sessionId: 'terminate-owner', hasSession: true, provider: 'codex' });
  const first = createFakeSocket();
  handleShellConnection(first as never, dependencies);
  first.emit('message', init);
  first.emit('close');
  assert.equal(terminal.killed, false);
  const replacement = createFakeSocket();
  handleShellConnection(replacement as never, dependencies);
  replacement.emit('message', init);
  first.emit('message', JSON.stringify({ type: 'terminate' }));
  assert.equal(terminal.killed, false);
  replacement.emit('message', JSON.stringify({ type: 'terminate' }));
  assert.equal(terminal.killed, true);
  terminal.emitExit();
});

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
