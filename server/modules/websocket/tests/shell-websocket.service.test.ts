import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { WebSocket } from 'ws';

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

test('Antigravity shells execute the configured path literally and inherit CLI search paths', { skip: process.platform === 'win32' }, () => {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'agy-shell-'));
  const executable = path.join(tempRoot, "agent's tools $literal");
  const pathKey = Object.keys(process.env).find((key) => key.toLowerCase() === 'path') ?? 'PATH';
  const previousPath = process.env[pathKey];
  const previousExecutable = process.env.AGY_CLI_PATH;
  try {
    writeFileSync(executable, '#!/bin/sh\nprintf "%s\\n" "$@"\n');
    chmodSync(executable, 0o755);
    process.env.AGY_CLI_PATH = `"${executable}"`;
    process.env[pathKey] = '/only/system';
    for (const hasSession of [false, true]) {
      const pty = createFakePty();
      const socket = createFakeSocket();
      let capturedCommand = '';
      let capturedEnv: NodeJS.ProcessEnv = {};
      handleShellConnection(socket as never, {
        resolveProviderSessionId: () => 'native-conversation',
        spawnPty: (_shell, args, options) => {
          capturedCommand = args.at(-1)!;
          capturedEnv = options.env ?? {};
          return pty as never;
        },
      });
      socket.emit('message', JSON.stringify({
        type: 'init', provider: 'antigravity', projectPath: process.cwd(),
        sessionId: `agy-configured-${hasSession}`, hasSession,
      }));
      const result = spawnSync('/bin/bash', ['-c', capturedCommand], { env: capturedEnv, encoding: 'utf8' });
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stdout, hasSession ? '--conversation\nnative-conversation\n' : '\n');
      const entries = capturedEnv[pathKey]?.split(path.delimiter) ?? [];
      assert.ok(entries.includes(path.join(os.homedir(), '.local', 'bin')));
      assert.ok(entries.includes('/only/system'));
      pty.emitExit();
    }
  } finally {
    if (previousPath === undefined) delete process.env[pathKey];
    else process.env[pathKey] = previousPath;
    if (previousExecutable === undefined) delete process.env.AGY_CLI_PATH;
    else process.env.AGY_CLI_PATH = previousExecutable;
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('Antigravity PowerShell commands quote configured executables and preserve explicit commands', (context) => {
  context.mock.method(os, 'platform', () => 'win32');
  const previousExecutable = process.env.AGY_CLI_PATH;
  const commands: string[] = [];
  try {
    process.env.AGY_CLI_PATH = "C:\\Agent's tools\\agy.cmd";
    for (const [hasSession, initialCommand] of [[true, ''], [false, 'Write-Output explicit']] as const) {
      const pty = createFakePty();
      const socket = createFakeSocket();
      handleShellConnection(socket as never, {
        resolveProviderSessionId: () => 'native-id',
        spawnPty: (_shell, args) => {
          commands.push(args.at(-1)!);
          return pty as never;
        },
      });
      socket.emit('message', JSON.stringify({
        type: 'init', provider: 'antigravity', projectPath: process.cwd(),
        sessionId: `agy-powershell-${hasSession}`, hasSession, initialCommand,
      }));
      pty.emitExit();
    }
    assert.deepEqual(commands, [
      "& 'C:\\Agent''s tools\\agy.cmd' --conversation \"native-id\"",
      'Write-Output explicit',
    ]);
  } finally {
    if (previousExecutable === undefined) delete process.env.AGY_CLI_PATH;
    else process.env.AGY_CLI_PATH = previousExecutable;
  }
});
