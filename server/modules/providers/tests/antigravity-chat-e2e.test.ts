/**
 * Antigravity Chat End-to-End Test
 *
 * Boots the REAL server (server/index.ts) as a child process with a fully
 * isolated environment (temp HOME, temp database, stub `agy` binary), then
 * exercises the exact path the WebUI uses:
 *
 *   register (REST) → create app session (REST) → WebSocket /ws →
 *   chat.send → stream_delta/complete → chat.abort
 *
 * The stub `agy` records its argv and replays canned stream-json events in
 * the real wire format, so no login or network access is needed. Provider
 * runtime unit tests live in antigravity-runtime.test.ts; this file guards
 * the integration seams around it (auth, session gateway, WS protocol,
 * provider-id remapping, resume mapping persistence).
 */

import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { createRequire } from 'node:module';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';

import WebSocket from 'ws';

const require = createRequire(import.meta.url);
const tsxCliPath = require.resolve('tsx/cli');
const thisDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(thisDir, '..', '..', '..', '..');

// --------------- stub `agy` binary ---------------
// The stub replays the same event sequence as a real logged-in `agy -p ... --
// output-format stream-json` run (see antigravity-runtime.test.ts for the
// unit-level variant). Sleep mode is toggled at invocation time via a marker
// file because the stub inherits the server child's fixed environment.
const stubDir = fsSync.mkdtempSync(path.join(os.tmpdir(), 'agy-e2e-stub-'));
const stubPath = path.join(stubDir, 'agy');
const argsFilePath = path.join(stubDir, 'args.txt');
const sleepModeMarkerPath = path.join(stubDir, 'sleep-mode');
const failModeMarkerPath = path.join(stubDir, 'fail-mode');

const stubScript = `#!/usr/bin/env node
const fs = require('fs');
fs.writeFileSync(process.env.AGY_ARGS_FILE, process.argv.slice(2).join('\\n') + '\\n');
if (process.env.AGY_FAIL_FILE && fs.existsSync(process.env.AGY_FAIL_FILE)) {
  console.error('agy: quota exceeded for project');
  process.exit(1);
}
if (process.env.AGY_MODE_FILE && fs.existsSync(process.env.AGY_MODE_FILE)) {
  process.on('SIGTERM', () => process.exit(0));
  setInterval(() => {}, 1000);
} else {
  console.log(JSON.stringify({ event: 'init', conversation_id: 'stub-conv-1', init: { cwd: '/tmp' } }));
  console.log(JSON.stringify({ event: 'step_update', step_update: { conversation_id: 'stub-conv-1', step_index: 2, state: 'DONE', step_type: 'agent_response', text_delta: 'OK' } }));
  console.log(JSON.stringify({ event: 'result', result: { conversation_id: 'stub-conv-1', status: 'SUCCESS', usage: { total_tokens: 42 } } }));
}
`;

fsSync.writeFileSync(stubPath, stubScript, { mode: 0o755 });

// --------------- isolated server environment ---------------
const e2eHome = fsSync.mkdtempSync(path.join(os.tmpdir(), 'agy-e2e-home-'));
const agyDataDir = path.join(e2eHome, 'agy-data');
fsSync.mkdirSync(agyDataDir, { recursive: true });

let serverProcess: ChildProcess | null = null;
let serverPort = 0;
let authToken = '';
const serverOutput: string[] = [];

function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as net.AddressInfo;
      probe.close(() => resolve(port));
    });
  });
}

async function waitForServerHealth(timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (serverProcess?.exitCode !== null && serverProcess?.exitCode !== undefined) {
      throw new Error(`server exited early with code ${serverProcess.exitCode}:\n${serverOutput.join('')}`);
    }
    try {
      const response = await fetch(`http://127.0.0.1:${serverPort}/health`);
      if (response.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`server did not become healthy within ${timeoutMs}ms:\n${serverOutput.join('')}`);
}

before(async () => {
  serverPort = await findFreePort();
  serverProcess = spawn(process.execPath, [tsxCliPath, 'server/index.ts'], {
    cwd: repoRoot,
    env: {
      ...process.env,
      // Point HOME at a temp dir so the server's local-server marker,
      // watcher roots and any other home-relative state stay isolated from
      // the developer's real environment.
      HOME: e2eHome,
      SERVER_PORT: String(serverPort),
      HOST: '127.0.0.1',
      DATABASE_PATH: path.join(e2eHome, 'auth.db'),
      JWT_SECRET: 'antigravity-e2e-secret',
      CLOUDCLI_ANTIGRAVITY_PATH: stubPath,
      CLOUDCLI_ANTIGRAVITY_DATA_DIR: agyDataDir,
      AGY_ARGS_FILE: argsFilePath,
      AGY_MODE_FILE: sleepModeMarkerPath,
      AGY_FAIL_FILE: failModeMarkerPath,
    },
  });
  serverProcess.stdout?.on('data', (chunk: Buffer) => serverOutput.push(chunk.toString()));
  serverProcess.stderr?.on('data', (chunk: Buffer) => serverOutput.push(chunk.toString()));

  await waitForServerHealth();

  const registerResponse = await fetch(`http://127.0.0.1:${serverPort}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'e2e-user', password: 'e2e-password' }),
  });
  if (!registerResponse.ok) {
    throw new Error(`register failed with ${registerResponse.status}: ${await registerResponse.text()}`);
  }
  const registerBody = await registerResponse.json() as { token: string };
  authToken = registerBody.token;
  assert.ok(authToken, 'register must return a JWT');
});

after(async () => {
  if (serverProcess && serverProcess.exitCode === null) {
    serverProcess.kill('SIGTERM');
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        serverProcess?.kill('SIGKILL');
        resolve();
      }, 5_000);
      serverProcess?.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }
  await fs.rm(stubDir, { recursive: true, force: true });
  await fs.rm(e2eHome, { recursive: true, force: true });
});

// --------------- helpers ---------------

type WireMessage = Record<string, unknown> & { kind?: string };

function connectWebSocket(): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${serverPort}/ws?token=${authToken}`);
    const messages: WireMessage[] = [];
    ws.on('message', (data: Buffer) => {
      try {
        messages.push(JSON.parse(data.toString()) as WireMessage);
      } catch {
        // ignore non-JSON frames
      }
    });
    ws.once('error', reject);
    ws.once('open', () => {
      ws.off('error', reject);
      (ws as WebSocket & { messages: WireMessage[] }).messages = messages;
      resolve(ws);
    });
  });
}

async function waitFor(ws: WebSocket, predicate: (message: WireMessage) => boolean, label: string): Promise<WireMessage> {
  const messages = (ws as WebSocket & { messages: WireMessage[] }).messages;
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const found = messages.find(predicate);
    if (found) return found;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`timed out waiting for ${label}; received so far: ${JSON.stringify(messages, null, 2)}`);
}

function sendChat(ws: WebSocket, sessionId: string, content: string): void {
  ws.send(JSON.stringify({ type: 'chat.send', sessionId, content, options: {} }));
}

async function createAppSession(initialMessage: string): Promise<string> {
  const response = await fetch(`http://127.0.0.1:${serverPort}/api/providers/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
    body: JSON.stringify({ provider: 'antigravity', projectPath: repoRoot, initialMessage }),
  });
  if (response.status !== 201) {
    throw new Error(`session creation failed with ${response.status}: ${await response.text()}`);
  }
  const body = await response.json() as { success: boolean; data: { sessionId: string } };
  assert.equal(body.success, true);
  return body.data.sessionId;
}

async function readRecordedArgs(): Promise<string[]> {
  const content = await fs.readFile(argsFilePath, 'utf8');
  return content.split('\n').filter((line) => line.length > 0);
}

async function waitForArgsFile(): Promise<void> {
  for (let i = 0; i < 100; i += 1) {
    try {
      await fs.access(argsFilePath);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  throw new Error('stub agy did not record args in time');
}

// --------------- tests ---------------

test('chat.send drives the full WebUI path: REST session → WS stream → remapped terminal events', async () => {
  const ws = await connectWebSocket();
  try {
    const appSessionId = await createAppSession('hello from e2e');
    sendChat(ws, appSessionId, 'hello from e2e');

    const delta = await waitFor(ws, (msg) => msg.kind === 'stream_delta', 'stream_delta');
    assert.equal(delta.content, 'OK');
    assert.equal(delta.sessionId, appSessionId, 'stream deltas must carry the stable app session id');

    const upsert = await waitFor(ws, (msg) => msg.kind === 'session_upserted', 'session_upserted');
    assert.equal(upsert.sessionId, appSessionId);
    assert.equal(upsert.providerSessionId, 'stub-conv-1', 'canonical upsert maps the app id to the provider id');

    const complete = await waitFor(ws, (msg) => msg.kind === 'complete', 'complete');
    assert.equal(complete.sessionId, appSessionId, 'complete must be remapped to the app session id');
    assert.equal(complete.actualSessionId, appSessionId, 'provider-native ids must never reach the client');
    assert.equal(complete.tokens, 42);
    assert.equal(complete.exitCode, 0);

    // The gateway writer swallows session_created; the client must never see
    // it (only the canonical session_upserted broadcast may reference the
    // provider-native id).
    assert.equal(
      messagesHaveKind(ws, 'session_created'),
      false,
      'session_created events are swallowed by the gateway writer',
    );

    const args = await readRecordedArgs();
    for (const expected of ['-p', 'hello from e2e', '--output-format', 'stream-json']) {
      assert.ok(args.includes(expected), `expected ${expected} in stub argv: ${JSON.stringify(args)}`);
    }
  } finally {
    ws.close();
  }
});

function messagesHaveKind(ws: WebSocket, kind: string): boolean {
  return (ws as WebSocket & { messages: WireMessage[] }).messages.some((msg) => msg.kind === kind);
}

test('a second chat.send resumes the provider conversation via the persisted id mapping', async () => {
  const ws = await connectWebSocket();
  try {
    // The first turn of this file's previous test already mapped the app
    // session to stub-conv-1; this new session starts fresh, so run two turns.
    const appSessionId = await createAppSession('first turn');
    sendChat(ws, appSessionId, 'first turn');
    await waitFor(ws, (msg) => msg.kind === 'complete' && msg.sessionId === appSessionId, 'first complete');

    sendChat(ws, appSessionId, 'second turn');
    // The stub overwrites the args file per invocation, so wait for the second
    // turn's argv specifically before asserting the resume flag.
    for (let i = 0; i < 100; i += 1) {
      try {
        const content = await fs.readFile(argsFilePath, 'utf8');
        if (content.includes('second turn')) break;
      } catch {
        // stub has not run yet
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    await waitFor(ws, (msg) => msg.kind === 'complete' && msg.sessionId === appSessionId, 'second complete');

    const args = await readRecordedArgs();
    assert.ok(args.includes('second turn'), `args file must hold the second turn's argv: ${JSON.stringify(args)}`);
    const conversationIndex = args.indexOf('--conversation');
    assert.ok(conversationIndex !== -1, `resume must pass --conversation: ${JSON.stringify(args)}`);
    assert.equal(args[conversationIndex + 1], 'stub-conv-1', 'resume must use the provider-native conversation id from the DB');
  } finally {
    ws.close();
  }
});

test('chat.abort stops a running agy process and emits exactly one aborted complete', async () => {
  const ws = await connectWebSocket();
  try {
    await fs.writeFile(sleepModeMarkerPath, 'sleep');
    const appSessionId = await createAppSession('abort me');
    sendChat(ws, appSessionId, 'abort me');
    await waitForArgsFile(); // stub process spawned and registered

    ws.send(JSON.stringify({ type: 'chat.abort', sessionId: appSessionId }));

    const completions = new Map<string, WireMessage>();
    const messages = (ws as WebSocket & { messages: WireMessage[] }).messages;
    const collectCompletions = () => {
      for (const msg of messages) {
        if (msg.kind === 'complete' && msg.sessionId === appSessionId) {
          completions.set(String(msg.id), msg);
        }
      }
    };
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      collectCompletions();
      if (completions.size > 0) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    // Give the runtime's own exit-driven complete (if buggy: a duplicate) a
    // moment to arrive before asserting the exactly-one contract.
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    collectCompletions();

    const completionList = [...completions.values()];
    assert.equal(completionList.length, 1, `expected exactly one complete, got ${JSON.stringify(completionList)}`);
    assert.equal(completionList[0].aborted, true);
    assert.equal(messagesHaveKind(ws, 'error'), false, 'abort must not surface as an error');
  } finally {
    await fs.rm(sleepModeMarkerPath, { force: true });
    ws.close();
  }
});

test('a failing agy run surfaces stderr to the WebUI client and still completes', async () => {
  const ws = await connectWebSocket();
  try {
    await fs.writeFile(failModeMarkerPath, 'fail');
    const appSessionId = await createAppSession('trigger failure');
    sendChat(ws, appSessionId, 'trigger failure');

    await waitFor(ws, (msg) => (
      msg.kind === 'error' && msg.sessionId === appSessionId
        && String(msg.content).includes('quota exceeded')
    ), 'error carrying the stderr tail');

    const completions = new Map<string, WireMessage>();
    const messages = (ws as WebSocket & { messages: WireMessage[] }).messages;
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      for (const msg of messages) {
        if (msg.kind === 'complete' && msg.sessionId === appSessionId) {
          completions.set(String(msg.id), msg);
        }
      }
      if (completions.size > 0) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    const completionList = [...completions.values()];
    assert.equal(completionList.length, 1, `expected exactly one complete, got ${JSON.stringify(completionList)}`);
    assert.equal(completionList[0].exitCode, 1);
  } finally {
    await fs.rm(failModeMarkerPath, { force: true });
    ws.close();
  }
});
