import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { WebSocket } from 'ws';

import { chatRunRegistry } from '@/modules/websocket/services/chat-run-registry.service.js';
import {
  endUnusedShellsForSession,
  handleShellConnection,
  isSessionHeldByShell,
} from '@/modules/websocket/services/shell-websocket.service.js';

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

/**
 * Spawns fake PTYs and records the command line each one would have run, so a
 * test can tell "attached to the live PTY" apart from "started another CLI".
 */
function createSpawnRecorder(providerSessionId = 'provider-sid') {
  const commands: string[] = [];
  const ptys: Array<ReturnType<typeof createFakePty>> = [];
  return {
    commands,
    ptys,
    dependencies: {
      resolveProviderSessionId: () => providerSessionId,
      spawnPty: (_shell: string, args: string | string[]) => {
        commands.push(Array.isArray(args) ? args[args.length - 1] : args);
        const fakePty = createFakePty();
        ptys.push(fakePty);
        return fakePty as never;
      },
    },
  };
}

function openShell(
  dependencies: ReturnType<typeof createSpawnRecorder>['dependencies'],
  init: Record<string, unknown>,
) {
  const socket = createFakeSocket();
  handleShellConnection(socket as never, dependencies);
  socket.emit(
    'message',
    JSON.stringify({ type: 'init', projectPath: process.cwd(), provider: 'claude', ...init }),
  );
  return socket;
}

function readFrames(socket: ReturnType<typeof createFakeSocket>) {
  return socket.frames.map((frame) => JSON.parse(frame) as Record<string, unknown>);
}

function startChatRun(appSessionId: string) {
  const run = chatRunRegistry.startRun({
    appSessionId,
    provider: 'claude',
    providerSessionId: 'provider-sid',
    connection: null,
    userId: null,
  });
  assert.ok(run);
}

test('a Shell resume is refused while Chat is running a turn on the same session', () => {
  const sessionId = `chat-busy-${Date.now()}`;
  const recorder = createSpawnRecorder();
  startChatRun(sessionId);

  try {
    const socket = openShell(recorder.dependencies, { sessionId, hasSession: true });
    // Restart is the other way the Shell tab starts a CLI; it must not slip past.
    const restartSocket = openShell(recorder.dependencies, { sessionId, hasSession: true, forceRestart: true });

    assert.deepEqual(recorder.commands, []);
    for (const refused of [socket, restartSocket]) {
      const frames = readFrames(refused);
      assert.equal(frames.length, 1);
      assert.equal(frames[0].type, 'error');
      assert.match(String(frames[0].message), /running in Chat/);
    }
    assert.equal(isSessionHeldByShell(sessionId), false);

    // Once the turn has finished the same Shell request resumes normally.
    chatRunRegistry.completeRun(sessionId, { exitCode: 0 });
    const afterRun = openShell(recorder.dependencies, { sessionId, hasSession: true });

    assert.equal(recorder.commands.length, 1);
    if (os.platform() !== 'win32') {
      assert.equal(recorder.commands[0], 'claude --resume "provider-sid" || claude');
    }
    assert.match(String(readFrames(afterRun).at(-1)?.data), /Resuming Claude session provider-sid/);
  } finally {
    recorder.ptys.forEach((fakePty) => fakePty.emitExit());
    chatRunRegistry.clearAll();
  }
});

test('a Shell resume is refused while a finished turn is held open for background work', () => {
  const sessionId = `chat-held-${Date.now()}`;
  const recorder = createSpawnRecorder();
  startChatRun(sessionId);
  chatRunRegistry.completeRun(sessionId, { exitCode: 0 });
  chatRunRegistry.setRetentionGuard((appSessionId) => appSessionId === sessionId);

  try {
    const socket = openShell(recorder.dependencies, { sessionId, hasSession: true });

    assert.deepEqual(recorder.commands, []);
    assert.equal(readFrames(socket)[0]?.type, 'error');
  } finally {
    chatRunRegistry.setRetentionGuard(() => false);
    recorder.ptys.forEach((fakePty) => fakePty.emitExit());
    chatRunRegistry.clearAll();
  }
});

test('a busy chat session does not stop plain shells, new sessions, or reattaching', () => {
  const sessionId = `chat-busy-others-${Date.now()}`;
  const recorder = createSpawnRecorder();

  try {
    // A Shell that was already resuming the session before the chat turn began.
    openShell(recorder.dependencies, { sessionId, hasSession: true });
    assert.equal(recorder.commands.length, 1);
    startChatRun(sessionId);

    // Attaching to that PTY starts no second process, so it stays allowed.
    const reattached = openShell(recorder.dependencies, { sessionId, hasSession: true });
    assert.equal(recorder.commands.length, 1);
    assert.match(String(readFrames(reattached)[0]?.data), /Reconnected to existing session/);

    // A plain shell and a brand-new agent session never resume this session.
    openShell(recorder.dependencies, {
      sessionId,
      hasSession: false,
      provider: 'plain-shell',
      isPlainShell: true,
      initialCommand: 'plain-command',
    });
    openShell(recorder.dependencies, { sessionId: null, hasSession: false });
    assert.equal(recorder.commands.length, 3);
  } finally {
    recorder.ptys.forEach((fakePty) => fakePty.emitExit());
    chatRunRegistry.clearAll();
  }
});

test('only a live agent Shell that resumed the session counts as holding it', () => {
  const sessionId = `shell-holds-${Date.now()}`;
  const recorder = createSpawnRecorder();

  try {
    openShell(recorder.dependencies, {
      sessionId,
      hasSession: false,
      provider: 'plain-shell',
      isPlainShell: true,
      initialCommand: 'plain-command',
    });
    assert.equal(isSessionHeldByShell(sessionId), false);

    openShell(recorder.dependencies, { sessionId, hasSession: true });
    assert.equal(isSessionHeldByShell(sessionId), true);
    assert.equal(isSessionHeldByShell(`${sessionId}-other`), false);

    // `/exit` in the CLI ends the PTY, which releases the session for Chat.
    recorder.ptys[1].emitExit();
    assert.equal(isSessionHeldByShell(sessionId), false);
  } finally {
    recorder.ptys.forEach((fakePty) => fakePty.emitExit());
  }
});

test('a Shell that was only opened and then left is ended for Chat; one the user typed a line into is kept', () => {
  const viewedId = `shell-viewed-${Date.now()}`;
  const usedId = `shell-used-${Date.now()}`;
  const recorder = createSpawnRecorder();
  const input = (socket: ReturnType<typeof createFakeSocket>, data: string) =>
    socket.emit('message', JSON.stringify({ type: 'input', data }));

  try {
    // Opening the Shell tab resumes the session on its own. Terminal replies
    // (focus, colour) and unsubmitted typing are not work the user started.
    const viewed = openShell(recorder.dependencies, { sessionId: viewedId, hasSession: true });
    input(viewed, '\x1b[I');
    input(viewed, '\x1b]11;rgb:1e1e/1e1e/1e1e\x07');
    input(viewed, 'half a thought');
    const used = openShell(recorder.dependencies, { sessionId: usedId, hasSession: true });
    input(used, 'refactor the parser\r');
    const [viewedPty, usedPty] = recorder.ptys;

    // While a Shell tab is attached either one may be about to be used.
    endUnusedShellsForSession(viewedId);
    endUnusedShellsForSession(usedId);
    assert.equal(viewedPty.killed, false);
    assert.equal(isSessionHeldByShell(viewedId), true);

    // Leaving the tab closes its socket; the PTYs wait out the detach timeout.
    viewed.emit('close');
    used.emit('close');
    assert.equal(isSessionHeldByShell(viewedId), false, 'an untouched Shell does not block Chat');
    assert.equal(isSessionHeldByShell(usedId), true, 'a CLI the user ran something in does');

    endUnusedShellsForSession(viewedId);
    endUnusedShellsForSession(usedId);
    assert.equal(viewedPty.killed, true);
    assert.equal(usedPty.killed, false);

    // The next visit resumes a fresh CLI instead of reattaching to the ended one.
    openShell(recorder.dependencies, { sessionId: viewedId, hasSession: true });
    assert.equal(recorder.commands.length, 3);
  } finally {
    recorder.ptys.forEach((fakePty) => fakePty.emitExit());
  }
});

test('a refused Restart leaves the live PTY on that key running', () => {
  const sessionId = `restart-refused-${Date.now()}`;
  const recorder = createSpawnRecorder();

  try {
    openShell(recorder.dependencies, { sessionId, hasSession: true });
    // A turn that began while the Shell was already up (the chat side refuses
    // that itself; the registry is driven directly to pin the Shell's order).
    startChatRun(sessionId);

    const restart = openShell(recorder.dependencies, { sessionId, hasSession: true, forceRestart: true });

    assert.equal(readFrames(restart)[0]?.type, 'error');
    assert.equal(recorder.commands.length, 1);
    assert.equal(recorder.ptys[0].killed, false, 'the refusal comes before the restart kills anything');
    assert.equal(isSessionHeldByShell(sessionId), true);
  } finally {
    recorder.ptys.forEach((fakePty) => fakePty.emitExit());
    chatRunRegistry.clearAll();
  }
});

test('a Shell resume is refused while the provider process outlives its turn', () => {
  const sessionId = `process-held-${Date.now()}`;
  const recorder = createSpawnRecorder();
  // A Claude process held for a deferred wake-up reports no task, so neither
  // the run status nor the retention guard sees it; the runtime does.
  chatRunRegistry.setLiveProcessProbe((appSessionId) => appSessionId === sessionId);

  try {
    const socket = openShell(recorder.dependencies, { sessionId, hasSession: true });

    assert.deepEqual(recorder.commands, []);
    assert.equal(readFrames(socket)[0]?.type, 'error');
    assert.match(String(readFrames(socket)[0]?.message), /background work/);
  } finally {
    chatRunRegistry.setLiveProcessProbe(() => false);
    recorder.ptys.forEach((fakePty) => fakePty.emitExit());
  }
});

test('a socket that sent two inits releases each session when that PTY exits or the socket closes', () => {
  const firstId = `two-inits-a-${Date.now()}`;
  const secondId = `two-inits-b-${Date.now()}`;
  const recorder = createSpawnRecorder();

  try {
    const socket = openShell(recorder.dependencies, { sessionId: firstId, hasSession: true });
    socket.emit('message', JSON.stringify({
      type: 'init', projectPath: process.cwd(), provider: 'claude', sessionId: secondId, hasSession: true,
    }));
    const [firstPty, secondPty] = recorder.ptys;
    assert.equal(recorder.commands.length, 2);

    // Each PTY's exit removes its own entry, not the one the socket named last.
    firstPty.emitExit();
    assert.equal(isSessionHeldByShell(firstId), false);
    assert.equal(isSessionHeldByShell(secondId), true);

    // Reopened on the same socket, then the socket goes: both are detached.
    socket.emit('message', JSON.stringify({
      type: 'init', projectPath: process.cwd(), provider: 'claude', sessionId: firstId, hasSession: true,
    }));
    socket.emit('close');
    assert.equal(isSessionHeldByShell(firstId), false);
    assert.equal(isSessionHeldByShell(secondId), false);
    assert.equal(secondPty.killed, false);
  } finally {
    recorder.ptys.forEach((fakePty) => fakePty.emitExit());
  }
});
