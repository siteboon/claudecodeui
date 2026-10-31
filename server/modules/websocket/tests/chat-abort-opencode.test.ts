import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { closeConnection, initializeDatabase, sessionsDb } from '@/modules/database/index.js';
import { isOpenCodeSessionActive, opencodeRuntime } from '@/modules/providers/list/opencode/opencode-runtime.provider.js';
import { OpenCodeSessionsProvider } from '@/modules/providers/list/opencode/opencode-sessions.provider.js';
import { createProviderRuntimeService } from '@/modules/providers/services/provider-runtime.service.js';
import { handleChatConnection } from '@/modules/websocket/services/chat-websocket.service.js';
import { chatRunRegistry } from '@/modules/websocket/services/chat-run-registry.service.js';
import { connectedClients } from '@/modules/websocket/services/websocket-state.service.js';
import type { IProvider } from '@/shared/interfaces.js';

/**
 * Stopping an OpenCode turn from the chat, end to end through the chat gateway
 * and the real OpenCode runtime against a fake `opencode serve`: the open
 * prompt is withdrawn, and the chat gets exactly one terminal `complete`, the
 * aborted one the abort handler sends — not the failed one the gateway sends
 * for a runtime that settles before the abort has been reported.
 */

const SESSION_ID = 'opencode-chat';
const FIXTURE_PATH = fileURLToPath(new URL('../../providers/tests/fixtures/fake-opencode-serve.ts', import.meta.url));
const TSX_LOADER = import.meta.resolve('tsx/esm');

function createFakeSocket() {
  const socket = new EventEmitter() as EventEmitter & {
    readyState: number;
    frames: Array<Record<string, unknown>>;
    send: (data: string) => void;
  };
  socket.readyState = 1;
  socket.frames = [];
  socket.send = (data: string) => {
    const frame = JSON.parse(data) as Record<string, unknown>;
    socket.frames.push(frame);
    socket.emit('frame', frame);
  };
  return socket;
}

const findEnvKey = (name: string) =>
  Object.keys(process.env).find((key) => key.toLowerCase() === name.toLowerCase()) || name;

test('stopping an OpenCode turn sends one aborted complete and withdraws its prompt', async () => {
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
  const saved = {
    path: process.env[pathKey],
    pathExt: process.env[pathExtKey],
    home: process.env.HOME,
    databasePath: process.env.DATABASE_PATH,
    scenario: process.env.FAKE_OPENCODE_SCENARIO,
  };
  process.env[pathKey] = `${binDir}${path.delimiter}${saved.path || ''}`;
  if (process.platform === 'win32' && !saved.pathExt?.toUpperCase().includes('.CMD')) {
    process.env[pathExtKey] = `.COM;.EXE;.BAT;.CMD${saved.pathExt ? `;${saved.pathExt}` : ''}`;
  }
  process.env.HOME = tempRoot;
  process.env.FAKE_OPENCODE_SCENARIO = JSON.stringify({
    newSessionId: 'ses_abort',
    steps: [{ type: 'permission', id: 'per_abort', permission: 'bash', patterns: ['sleep 100'], always: ['sleep *'] }],
  });

  closeConnection();
  process.env.DATABASE_PATH = path.join(tempRoot, 'auth.db');
  await initializeDatabase();

  try {
    sessionsDb.createAppSession(SESSION_ID, 'opencode', projectDir);

    // The real runtime service, so the abort travels through the same async
    // layers as in production; only the registry lookups are stubbed.
    const sessions = new OpenCodeSessionsProvider();
    const provider = {
      id: 'opencode',
      runtime: opencodeRuntime,
      sessions,
      auth: { getStatus: async () => ({ installed: true }) },
    } as unknown as IProvider;
    const runtime = createProviderRuntimeService({
      listProviders: () => [provider],
      resolveProvider: () => provider,
      resolveProviderSessionId: () => null,
      resolveResumeModel: async () => 'fake/model',
      getProviderModels: async () => ({ OPTIONS: [], DEFAULT: '' }),
    });

    const socket = createFakeSocket();
    handleChatConnection(socket as never, { user: { id: 1 } } as never, { runtime });

    const prompted = new Promise<void>((resolve) => {
      socket.on('frame', (frame: Record<string, unknown>) => {
        if (frame.kind === 'permission_request') {
          resolve();
        }
      });
    });
    socket.emit('message', Buffer.from(JSON.stringify({ type: 'chat.send', sessionId: SESSION_ID, content: 'Hi' })));
    await prompted;

    socket.emit('message', Buffer.from(JSON.stringify({ type: 'chat.abort', sessionId: SESSION_ID })));

    // Settled once the run left the registry's running state and the
    // runtime no longer tracks the turn.
    const deadline = Date.now() + 15_000;
    while ((chatRunRegistry.isProcessing(SESSION_ID) || isOpenCodeSessionActive(SESSION_ID)) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    // Room for a late safety-net complete to show up if the order were wrong.
    await new Promise((resolve) => setTimeout(resolve, 300));

    const completes = socket.frames.filter((frame) => frame.kind === 'complete');
    assert.equal(completes.length, 1, 'exactly one terminal complete');
    assert.equal(completes[0].aborted, true);
    assert.equal(completes[0].exitCode, 0);
    const cancelled = socket.frames.find((frame) => frame.kind === 'permission_cancelled');
    assert.equal(cancelled?.requestId, 'per_abort');
    assert.equal(socket.frames.some((frame) => frame.kind === 'error' || frame.kind === 'protocol_error'), false);
  } finally {
    connectedClients.clear();
    chatRunRegistry.clearAll();
    closeConnection();
    for (const [key, value] of [
      [pathKey, saved.path],
      [pathExtKey, saved.pathExt],
      ['HOME', saved.home],
      ['DATABASE_PATH', saved.databasePath],
      ['FAKE_OPENCODE_SCENARIO', saved.scenario],
    ] as const) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    await rm(tempRoot, { recursive: true, force: true });
  }
});
