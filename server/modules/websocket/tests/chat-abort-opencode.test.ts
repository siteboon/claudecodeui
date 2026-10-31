import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { closeConnection, initializeDatabase, sessionsDb } from '@/modules/database/index.js';
import { providerRuntimeService } from '@/modules/providers/index.js';
import { handleChatConnection } from '@/modules/websocket/services/chat-websocket.service.js';
import { chatRunRegistry } from '@/modules/websocket/services/chat-run-registry.service.js';
import { connectedClients } from '@/modules/websocket/services/websocket-state.service.js';

/**
 * Stopping an OpenCode turn from the chat, end to end through the chat gateway
 * and the real provider runtime against a fake `opencode serve` (the providers
 * module's test fixture, put on PATH as `opencode`): the open prompt is
 * withdrawn, and the chat gets exactly one terminal `complete`, the aborted one
 * the abort handler sends — not the failed one the gateway sends for a runtime
 * that settles before the abort has been reported.
 */

const SESSION_ID = 'opencode-chat';
const FIXTURE_PATH = fileURLToPath(new URL('../../providers/tests/fixtures/fake-opencode-serve.ts', import.meta.url));
const TSX_LOADER = import.meta.resolve('tsx/esm');

type Frame = Record<string, unknown>;

function createFakeSocket() {
  const socket = new EventEmitter() as EventEmitter & {
    readyState: number;
    frames: Frame[];
    send: (data: string) => void;
  };
  socket.readyState = 1;
  socket.frames = [];
  socket.send = (data: string) => {
    const frame = JSON.parse(data) as Frame;
    socket.frames.push(frame);
    socket.emit('frame', frame);
  };
  return socket;
}

const findEnvKey = (name: string) =>
  Object.keys(process.env).find((key) => key.toLowerCase() === name.toLowerCase()) || name;

/** Waits for a matching frame; rejects instead of hanging the file when none comes. */
const waitForFrame = (
  socket: ReturnType<typeof createFakeSocket>,
  matches: (frame: Frame) => boolean,
  timeoutMs = 15_000,
) =>
  new Promise<Frame>((resolve, reject) => {
    const existing = socket.frames.find(matches);
    if (existing) {
      resolve(existing);
      return;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onFrame = (frame: Frame) => {
      if (matches(frame)) {
        clearTimeout(timer);
        socket.off('frame', onFrame);
        resolve(frame);
      }
    };
    timer = setTimeout(() => {
      socket.off('frame', onFrame);
      reject(new Error(`No matching frame within ${timeoutMs} ms.`));
    }, timeoutMs);
    socket.on('frame', onFrame);
  });

const sendFrame = (socket: ReturnType<typeof createFakeSocket>, payload: Frame) =>
  socket.emit('message', Buffer.from(JSON.stringify(payload)));

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const permissionScenario = (id: string, extra: Frame = {}) => JSON.stringify({
  ...extra,
  steps: [{ type: 'permission', id, permission: 'bash', patterns: ['sleep 100'], always: ['sleep *'] }],
});

/** A chat gateway on a temp database, with a fake `opencode` first on PATH. */
async function withOpenCodeGateway(runTest: (socket: ReturnType<typeof createFakeSocket>) => Promise<void>) {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'chat-abort-opencode-'));
  const binDir = path.join(tempRoot, 'bin');
  const projectDir = path.join(tempRoot, 'project');
  await Promise.all([mkdir(binDir), mkdir(projectDir)]);
  if (process.platform === 'win32') {
    await writeFile(path.join(binDir, 'opencode.cmd'), `@echo off\r\n"${process.execPath}" --import "${TSX_LOADER}" "${FIXTURE_PATH}" %*\r\n`);
  } else {
    await writeFile(path.join(binDir, 'opencode'), `#!/bin/sh\nexec "${process.execPath}" --import "${TSX_LOADER}" "${FIXTURE_PATH}" "$@"\n`);
    await chmod(path.join(binDir, 'opencode'), 0o755);
  }

  const pathKey = findEnvKey('PATH');
  const pathExtKey = findEnvKey('PATHEXT');
  const saved: Record<string, string | undefined> = {
    [pathKey]: process.env[pathKey],
    [pathExtKey]: process.env[pathExtKey],
    HOME: process.env.HOME,
    DATABASE_PATH: process.env.DATABASE_PATH,
    FAKE_OPENCODE_SCENARIO: process.env.FAKE_OPENCODE_SCENARIO,
  };
  process.env[pathKey] = `${binDir}${path.delimiter}${saved[pathKey] || ''}`;
  if (process.platform === 'win32' && !saved[pathExtKey]?.toUpperCase().includes('.CMD')) {
    process.env[pathExtKey] = `.COM;.EXE;.BAT;.CMD${saved[pathExtKey] ? `;${saved[pathExtKey]}` : ''}`;
  }
  process.env.HOME = tempRoot;

  closeConnection();
  process.env.DATABASE_PATH = path.join(tempRoot, 'auth.db');
  await initializeDatabase();

  try {
    sessionsDb.createAppSession(SESSION_ID, 'opencode', projectDir);
    const socket = createFakeSocket();
    // The real runtime service and provider registry, so the abort travels
    // through the same layers as in production.
    handleChatConnection(socket as never, { user: { id: 1 } } as never, { runtime: providerRuntimeService });
    await runTest(socket);
  } finally {
    // A test that failed half-way leaves its turn and fake server running.
    await providerRuntimeService.abort('opencode', SESSION_ID).catch(() => false);
    connectedClients.clear();
    chatRunRegistry.clearAll();
    closeConnection();
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    await rm(tempRoot, { recursive: true, force: true });
  }
}

/** Waits until the session has no running run, then a little longer for any late frame. */
async function waitForSettledRun() {
  const deadline = Date.now() + 15_000;
  while (chatRunRegistry.isProcessing(SESSION_ID) && Date.now() < deadline) {
    await delay(20);
  }
  await delay(300);
}

test('stopping an OpenCode turn sends one aborted complete and withdraws its prompt', async () => {
  await withOpenCodeGateway(async (socket) => {
    process.env.FAKE_OPENCODE_SCENARIO = permissionScenario('per_abort');
    sendFrame(socket, { type: 'chat.send', sessionId: SESSION_ID, content: 'Hi', options: { model: 'fake/model' } });
    await waitForFrame(socket, (frame) => frame.kind === 'permission_request');

    sendFrame(socket, { type: 'chat.abort', sessionId: SESSION_ID });
    await waitForSettledRun();

    const completes = socket.frames.filter((frame) => frame.kind === 'complete');
    assert.equal(completes.length, 1, 'exactly one terminal complete');
    assert.equal(completes[0].aborted, true);
    assert.equal(completes[0].exitCode, 0);
    assert.equal(socket.frames.find((frame) => frame.kind === 'permission_cancelled')?.requestId, 'per_abort');
    assert.equal(socket.frames.some((frame) => frame.kind === 'error' || frame.kind === 'protocol_error'), false);
    assert.deepEqual(providerRuntimeService.getPendingApprovalsForSession(SESSION_ID), []);
  });
});

test('a second stop neither ends the turn early nor the next turn later', async () => {
  await withOpenCodeGateway(async (socket) => {
    // OpenCode takes a while to confirm the stop, so the second Stop (or a
    // second Esc) lands while the first is still in progress.
    process.env.FAKE_OPENCODE_SCENARIO = permissionScenario('per_first', { abortDelayMs: 800 });
    sendFrame(socket, { type: 'chat.send', sessionId: SESSION_ID, content: 'Hi', options: { model: 'fake/model' } });
    await waitForFrame(socket, (frame) => frame.kind === 'permission_request');

    sendFrame(socket, { type: 'chat.abort', sessionId: SESSION_ID });
    await delay(50);
    sendFrame(socket, { type: 'chat.abort', sessionId: SESSION_ID });

    const firstComplete = await waitForFrame(socket, (frame) => frame.kind === 'complete');
    assert.equal(firstComplete.aborted, true);
    assert.equal(firstComplete.exitCode, 0, 'the turn is reported stopped only once its stop has finished');

    // The next message, sent the moment the chat sees the turn end.
    process.env.FAKE_OPENCODE_SCENARIO = permissionScenario('per_second');
    sendFrame(socket, { type: 'chat.send', sessionId: SESSION_ID, content: 'Again', options: { model: 'fake/model' } });
    await waitForFrame(socket, (frame) => frame.kind === 'permission_request' && frame.requestId === 'per_second');
    await delay(1000);

    assert.equal(chatRunRegistry.isProcessing(SESSION_ID), true, 'the new turn is still running');
    assert.equal(socket.frames.filter((frame) => frame.kind === 'complete').length, 1);

    sendFrame(socket, { type: 'chat.abort', sessionId: SESSION_ID });
    await waitForSettledRun();
  });
});
