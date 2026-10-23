import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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
 * Stop in the chat (`chat.abort`) sends the stopped turn's terminal
 * `complete` once the runtime's abort returns; the turn's own dispatch then
 * settles and its safety net (`completeRunIfCurrent`, exit code 1) is dropped
 * as a duplicate. OpenCode's serve runtime (#1569) aborts over HTTP and waits
 * for the session to settle, so its turn can end while that abort is still
 * waiting. This drives the real gateway and the real OpenCode runtime against
 * the fake `opencode serve` of the providers tests: the chat must see the Stop
 * as `complete { aborted: true, exitCode: 0 }`, not as a failed run.
 */

const TESTS_DIR = path.dirname(fileURLToPath(import.meta.url));
const APPLICATION_ROOT = path.resolve(TESTS_DIR, '..', '..', '..', '..');
const FAKE_OPENCODE = path.join(APPLICATION_ROOT, 'server', 'modules', 'providers', 'tests', 'fixtures', 'fake-opencode-serve.ts');
const TSX_LOADER = import.meta.resolve('tsx');
const SESSION_ID = 'opencode-stop-session';
const ENV_KEYS = ['PATH', 'HOME', 'DATABASE_PATH', 'TSX_TSCONFIG_PATH', 'OPENCODE_PERMISSION', 'FAKE_OPENCODE_SCENARIO', 'FAKE_OPENCODE_CAPTURE'];

function createFakeSocket() {
  const socket = new EventEmitter() as EventEmitter & {
    readyState: number;
    frames: Array<Record<string, unknown>>;
    send: (data: string) => void;
  };
  socket.readyState = 1;
  socket.frames = [];
  socket.send = (data: string) => socket.frames.push(JSON.parse(data) as Record<string, unknown>);
  return socket;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitUntil(condition: () => boolean, timeoutMs: number): Promise<boolean> {
  const startedAt = Date.now();
  while (!condition()) {
    if (Date.now() - startedAt > timeoutMs) {
      return false;
    }
    await sleep(20);
  }
  return true;
}

test('Stop on an OpenCode turn that waits for a permission reports it as stopped, not failed', {
  skip: process.platform === 'win32' && 'the fake opencode is started through a POSIX shell shim',
}, async () => {
  const savedEnv = new Map(ENV_KEYS.map((key) => [key, process.env[key]]));
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'chat-abort-opencode-'));
  const projectDir = path.join(tempRoot, 'project');
  const binDir = path.join(tempRoot, 'bin');
  const capturePath = path.join(tempRoot, 'capture.jsonl');
  const scenarioPath = path.join(tempRoot, 'scenario.json');
  await mkdir(projectDir, { recursive: true });
  await mkdir(binDir, { recursive: true });
  await mkdir(path.join(tempRoot, 'home'), { recursive: true });
  const shim = path.join(binDir, 'opencode');
  await writeFile(shim, `#!/bin/sh\nexec "${process.execPath}" --import "${TSX_LOADER}" "${FAKE_OPENCODE}" "$@"\n`, 'utf8');
  await chmod(shim, 0o755);
  // A bash call waiting for the user; OpenCode takes the abort, then its event
  // stream ends without an idle, so the turn ends while the abort still waits.
  await writeFile(scenarioPath, JSON.stringify({
    newSessionId: 'ses_chat_stop',
    abortDropsEvents: true,
    steps: [
      {
        emit: {
          type: 'permission.asked',
          properties: {
            id: 'per_chat_stop',
            sessionID: '$SID',
            permission: 'bash',
            patterns: ['sleep 30'],
            metadata: { command: 'sleep 30' },
            always: ['sleep *'],
          },
        },
      },
      { await: 'per_chat_stop' },
    ],
  }), 'utf8');
  await writeFile(capturePath, '', 'utf8');

  process.env.PATH = `${binDir}${path.delimiter}${process.env.PATH ?? ''}`;
  process.env.HOME = path.join(tempRoot, 'home');
  process.env.DATABASE_PATH = path.join(tempRoot, 'auth.db');
  process.env.TSX_TSCONFIG_PATH = path.join(APPLICATION_ROOT, 'server', 'tsconfig.json');
  process.env.FAKE_OPENCODE_SCENARIO = scenarioPath;
  process.env.FAKE_OPENCODE_CAPTURE = capturePath;
  delete process.env.OPENCODE_PERMISSION;

  closeConnection();
  await initializeDatabase();
  const socket = createFakeSocket();
  try {
    sessionsDb.createAppSession(SESSION_ID, 'opencode', projectDir);
    // No signed-in user: nobody to send the action-required notification to.
    handleChatConnection(socket as never, {} as never, { runtime: providerRuntimeService as never });

    socket.emit('message', JSON.stringify({
      type: 'chat.send',
      sessionId: SESSION_ID,
      content: 'Run it',
      options: { model: 'fake/fake-model', cwd: projectDir },
    }));
    assert.ok(
      await waitUntil(() => socket.frames.some((frame) => frame.kind === 'permission_request'), 15_000),
      'the permission request never reached the chat',
    );

    socket.emit('message', JSON.stringify({ type: 'chat.abort', sessionId: SESSION_ID }));
    assert.ok(
      await waitUntil(() => chatRunRegistry.getRun(SESSION_ID)?.status === 'completed', 15_000),
      'the stopped run never completed',
    );
    // Let the turn's own dispatch settle too: its safety net comes last.
    await sleep(500);

    const completes = socket.frames.filter((frame) => frame.kind === 'complete');
    assert.equal(completes.length, 1);
    assert.equal(completes[0].aborted, true);
    assert.equal(completes[0].exitCode, 0);
    assert.equal(socket.frames.some((frame) => frame.kind === 'error'), false);
  } finally {
    connectedClients.clear();
    chatRunRegistry.clearAll();
    closeConnection();
    // No fake server may outlive the test.
    const capture = (await readFile(capturePath, 'utf8')).split('\n').filter(Boolean);
    for (const line of capture) {
      const { pid } = JSON.parse(line) as { pid: number };
      for (const target of [-pid, pid]) {
        try {
          process.kill(target, 'SIGKILL');
        } catch {
          // Gone already.
        }
      }
    }
    for (const [key, value] of savedEnv) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    await rm(tempRoot, { recursive: true, force: true });
  }
});
