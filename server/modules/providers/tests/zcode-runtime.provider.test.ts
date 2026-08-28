/**
 * ZCode Runtime Unit Tests
 *
 * Drives the runtime against a stub app-server engine (injected via
 * CLOUDCLI_ZCODE_ENGINE) that mirrors the bidirectional protocol: while
 * handling session/create it issues a server-initiated
 * session/requestRuntimePreferences request and only completes the create once
 * the client answers — the exact flow that deadlocked against engine 0.16.3
 * (-32022 after the engine's 15s window). The create-fail mode verifies that
 * session/create failures reach the chat stream as error messages instead of
 * dying silently before the run's error reporting.
 */

import assert from 'node:assert/strict';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

import type {
  NormalizedMessage,
  ProviderRuntimeContext,
  ProviderRuntimeWriter,
} from '@/shared/types.js';

import { protocolClient } from '../list/zcode/zcode-protocol.client.js';
import { ZCodeRuntimeProvider } from '../list/zcode/zcode-runtime.provider.js';
import { ZCodeSessionsProvider } from '../list/zcode/zcode-sessions.provider.js';

const stubDir = fsSync.mkdtempSync(path.join(os.tmpdir(), 'zcode-stub-'));
const stubPath = path.join(stubDir, 'zcode-stub.cjs');
const modeFilePath = path.join(stubDir, 'mode.txt');
const logFilePath = path.join(stubDir, 'stub-log.jsonl');

// The engine's behavior mode is read from a file per session/create so both
// test cases can share one long-lived app-server subprocess.
const stubScript = `#!/usr/bin/env node
const fs = require('fs');
const readline = require('readline');

const modeFile = process.env.ZCODE_STUB_MODE_FILE;
const logFile = process.env.ZCODE_STUB_LOG;
const sessionId = 'sess_stub_1';

const send = (obj) => process.stdout.write(JSON.stringify(obj) + '\\n');
const log = (name, value) => {
  try { fs.appendFileSync(logFile, JSON.stringify({ name, value }) + '\\n'); } catch {}
};
const readMode = () => {
  try { return fs.readFileSync(modeFile, 'utf8').trim(); } catch { return 'ok'; }
};

let pendingCreateId = null;
const finishCreate = () => {
  if (pendingCreateId === null) return;
  send({ id: pendingCreateId, result: { sessionId } });
  pendingCreateId = null;
};

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on('line', (line) => {
  let msg;
  try { msg = JSON.parse(line); } catch { return; }

  // Responses to our server-initiated requests carry no method.
  if (msg.method === undefined) {
    if (msg.id === 'server-1') {
      log('prefs_response', msg);
      finishCreate();
    }
    return;
  }

  if (msg.method === 'session/create') {
    if (readMode() === 'create-fail') {
      send({ id: msg.id, error: { code: -32022, message: 'Client request timed out: session/requestRuntimePreferences', data: { timeoutMs: 15000 } } });
      return;
    }
    // Mirror the real engine: ask the client for runtime preferences while
    // the create is still pending, and only finish once it answers.
    pendingCreateId = msg.id;
    send({ id: 'server-1', method: 'session/requestRuntimePreferences', params: { sessionId, scope: 'runtime-materialization' } });
    return;
  }

  if (msg.method === 'session/send') {
    // Mirror the engine's strict schema: unknown keys are rejected.
    for (const key of Object.keys(msg.params ?? {})) {
      if (key !== 'sessionId' && key !== 'content' && key !== 'attachments') {
        send({ id: msg.id, error: { code: -32600, message: 'Invalid params — (root): Unrecognized key: "' + key + '"' } });
        return;
      }
    }
    send({ id: msg.id, result: {} });
    if (readMode() === 'send-fail') {
      send({ method: 'session/event', params: { sessionId, type: 'turn.failed', payload: { error: { message: 'provider auth failed', attribution: { statusCode: 401, reason: 'auth_failed' } } } } });
      return;
    }
    send({ method: 'session/event', params: { sessionId, type: 'model_streaming', payload: { kind: 'text_delta', delta: 'hi there' } } });
    send({ method: 'session/event', params: { sessionId, type: 'turn_complete', payload: { usage: { inputTokens: 3, outputTokens: 4 } } } });
    return;
  }

  // subscribe / setMode / setModel / stop / anything else: empty success.
  send({ id: msg.id, result: {} });
});
`;

fsSync.writeFileSync(stubPath, stubScript);
fsSync.writeFileSync(modeFilePath, 'ok\n');
fsSync.writeFileSync(logFilePath, '');

process.env.CLOUDCLI_ZCODE_ENGINE = stubPath;
process.env.ZCODE_STUB_MODE_FILE = modeFilePath;
process.env.ZCODE_STUB_LOG = logFilePath;

const sessionsProvider = new ZCodeSessionsProvider();

const context: ProviderRuntimeContext = {
  resolveProviderSessionId: () => null,
  resolveResumeModel: async () => undefined,
  getProviderModels: async () => ({ OPTIONS: [], DEFAULT: 'glm-5.3' }),
  normalizeMessage: (raw, sessionId) => sessionsProvider.normalizeMessage(raw, sessionId),
  isProviderInstalled: async () => true,
};

const createWriter = (): { messages: NormalizedMessage[]; writer: ProviderRuntimeWriter } => {
  const messages: NormalizedMessage[] = [];
  const writer: ProviderRuntimeWriter = {
    userId: null,
    send: (data: unknown) => messages.push(data as NormalizedMessage),
    setSessionId: () => undefined,
  };
  return { messages, writer };
};

const readStubLog = (): Array<{ name: string; value: unknown }> =>
  fsSync.readFileSync(logFilePath, 'utf8')
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as { name: string; value: unknown });

after(async () => {
  await protocolClient.shutdown();
});

test('runtime completes a run when the engine asks for runtime preferences mid-create', async () => {
  fsSync.writeFileSync(modeFilePath, 'ok\n');
  const runtime = new ZCodeRuntimeProvider();
  const { messages, writer } = createWriter();

  const result = await runtime.run('hello', { sessionId: 'app-sess-ok', cwd: stubDir }, writer, context);

  assert.deepEqual(result, { sessionId: 'sess_stub_1', success: true });

  // The engine's server-initiated request was answered, unblocking create.
  const prefsResponse = readStubLog().find((entry) => entry.name === 'prefs_response');
  assert.ok(prefsResponse, 'engine must receive a response to its runtime preferences request');
  assert.deepEqual(prefsResponse.value, {
    id: 'server-1',
    result: { nativeSearchEnhancementsEnabled: false },
  });

  assert.equal(messages.filter((msg) => msg.kind === 'session_created').length, 1);
  const delta = messages.find((msg) => msg.kind === 'stream_delta');
  assert.equal(delta?.content, 'hi there');
  const complete = messages.find((msg) => msg.kind === 'complete');
  assert.equal(complete?.tokens, 7);
});

test('runtime surfaces session/create failures as error messages', async () => {
  fsSync.writeFileSync(modeFilePath, 'create-fail\n');
  const runtime = new ZCodeRuntimeProvider();
  const { messages, writer } = createWriter();

  await assert.rejects(
    runtime.run('hello', { sessionId: 'app-sess-fail', cwd: stubDir }, writer, context),
    /Failed to create ZCode session/
  );

  const error = messages.find((msg) => msg.kind === 'error');
  assert.ok(error, 'session/create failure must reach the chat stream');
  assert.match(error.text ?? '', /Failed to create ZCode session/);
});

test('runtime reports turn.failed as an error and completes with a failing exit code', async () => {
  fsSync.writeFileSync(modeFilePath, 'send-fail\n');
  const runtime = new ZCodeRuntimeProvider();
  const { messages, writer } = createWriter();

  // Resolves (rather than throwing): the failure is carried by the error
  // message plus a complete with exitCode 1, matching the claude pattern.
  await runtime.run('hello', { sessionId: 'app-sess-sendfail', cwd: stubDir }, writer, context);

  const error = messages.find((msg) => msg.kind === 'error');
  assert.ok(error, 'turn.failed must surface as an error message');
  assert.equal(error.text, 'provider auth failed');
  const complete = messages.find((msg) => msg.kind === 'complete');
  assert.ok(complete, 'run must still terminate with a complete event');
  assert.equal(complete.exitCode, 1);
});
