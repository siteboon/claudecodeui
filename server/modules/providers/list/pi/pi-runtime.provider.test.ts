import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import type { NormalizedMessage, ProviderRuntimeContext, ProviderRuntimeWriter } from '@/shared/types.js';
import { AppError } from '@/shared/utils.js';

import {
  abortPiSession,
  buildPiArgs,
  handlePiRecord,
  isPiSessionActive,
  piRuntime,
} from './pi-runtime.provider.js';
import { mapPiEventToMessages } from './pi-sessions.provider.js';

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

// The runtime contract only cares that normalizeMessage maps one raw pi event
// onto zero or more normalized messages, so the context wires the sessions
// facet's real mapping — the same one the live provider registry serves.
// Sessions start brand-new by default: no provider-native id is known yet.
const makeRuntimeContext = (overrides: Partial<ProviderRuntimeContext> = {}): ProviderRuntimeContext => ({
  resolveProviderSessionId: () => null,
  resolveResumeModel: async (_sessionId, requestedModel) => requestedModel || undefined,
  getProviderModels: async () => ({ OPTIONS: [], DEFAULT: '' }),
  normalizeMessage: (raw, sessionId) => mapPiEventToMessages(raw, sessionId),
  isProviderInstalled: async () => true,
  ...overrides,
});

// Shapes copied from a recorded `pi -p --mode json` transcript (pi 0.85.1);
// RPC mode (pi 1.6) streams the same session events after a `prompt` command
// is accepted. Field shapes are the protocol facts both the runtime and the
// sessions normalizer build on.
const FAKE_SESSION_ID = '0198c0de-7a5b-7f3e-9a1c-3d2e4f5a6b7c';
const ZERO_USAGE = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 };
const FINAL_USAGE = {
  input: 1474,
  output: 18,
  cacheRead: 128,
  cacheWrite: 0,
  totalTokens: 1620,
  cost: { input: 0.001, output: 0.002, total: 0.003 },
};

const findEnvKey = (name: string): string =>
  Object.keys(process.env).find((key) => key.toLowerCase() === name.toLowerCase()) || name;

/**
 * A fake `pi` that speaks the RPC protocol: JSONL commands in on stdin,
 * responses and session events out on stdout, orderly exit on stdin EOF.
 *
 * `PI_EVENT_MODE` selects the behaviour the tests need; every command the
 * fake receives is appended to `PI_COMMAND_LOG`, which is how a test learns
 * that a run has reached a given point without guessing at timings.
 */
async function writeFakePi(binDir: string): Promise<void> {
  const scriptPath = path.join(binDir, 'pi.js');
  const NEWLINE = JSON.stringify('\n');
  await writeFile(scriptPath, `
const fs = require('node:fs');
const args = process.argv.slice(2);
if (process.env.PI_ARGS_CAPTURE) {
  fs.writeFileSync(process.env.PI_ARGS_CAPTURE, JSON.stringify(args));
}
const mode = process.env.PI_EVENT_MODE || 'replay';
const commandLog = process.env.PI_COMMAND_LOG || '';
const note = (line) => { if (commandLog) fs.appendFileSync(commandLog, line + ${NEWLINE}); };
note('spawn ' + process.pid + ' ' + mode);

// Resume runs keep the session id pi was started with; new runs mint a fixed one.
const sessionFlagIndex = args.indexOf('--session');
const sessionId = sessionFlagIndex >= 0 ? args[sessionFlagIndex + 1] : ${JSON.stringify(FAKE_SESSION_ID)};
const send = (record) => process.stdout.write(JSON.stringify(record) + ${NEWLINE});
const reply = (id, command, data) => send({ type: 'response', id, command, success: true, ...(data === undefined ? {} : { data }) });

const timestamp = 1733234401000;
function turn({ aborted = false } = {}) {
  send({ type: 'agent_start' });
  send({ type: 'turn_start' });
  send({ type: 'message_start', message: { role: 'user', content: [{ type: 'text', text: 'Say hi' }], timestamp } });
  send({ type: 'message_end', message: { role: 'user', content: [{ type: 'text', text: 'Say hi' }], timestamp } });
  send({ type: 'message_start', message: { role: 'assistant', content: [{ type: 'text', text: '' }], stopReason: 'pending' } });
  if (aborted) {
    // What pi writes when an abort lands mid-turn: the partial message is
    // kept and the run reports that it was aborted.
    send({ type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: 'Hello' }], stopReason: 'aborted' } });
    send({ type: 'agent_end', messages: [], aborted: true });
    send({ type: 'agent_settled', aborted: true });
    return;
  }
  send({ type: 'message_update', usage: ${JSON.stringify(ZERO_USAGE)}, assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: 'Hello' } });
  send({ type: 'message_update', usage: ${JSON.stringify(FINAL_USAGE)}, assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: ' world' } });
  send({ type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: 'Hello world' }], stopReason: 'stop', usage: ${JSON.stringify(FINAL_USAGE)} } });
  send({ type: 'turn_end' });
  send({ type: 'agent_end', messages: [] });
  send({ type: 'agent_settled', aborted: false });
}

if (mode === 'exit-early') {
  // A pi too old for RPC mode: the CLI rejects the option and exits.
  process.stderr.write("error: unknown option '--mode rpc'" + ${NEWLINE});
  process.exit(2);
}

function handle(command) {
  note(command.type + (command.type === 'extension_ui_response' ? ' ' + JSON.stringify(command) : ''));
  switch (command.type) {
    case 'get_state':
      if (mode === 'garbage') {
        // An extension logging to stdout: not a protocol record.
        process.stdout.write('pi: warning: partially written line' + ${NEWLINE});
      }
      reply(command.id, 'get_state', {
        sessionId,
        sessionFile: '/sessions/' + sessionId + '.jsonl',
        thinkingLevel: 'medium',
        isStreaming: false,
        messageCount: 0,
      });
      return;
    case 'prompt':
      if (mode === 'reject-prompt') {
        send({ type: 'response', id: command.id, command: 'prompt', success: false, error: 'Model not found: invalid/model' });
        return;
      }
      reply(command.id, 'prompt', { disposition: 'started' });
      if (mode === 'hang' || mode === 'hang-ignore-abort') {
        // Long-running turn: streams, then never settles on its own.
        send({ type: 'agent_start' });
        send({ type: 'message_start', message: { role: 'assistant', content: [{ type: 'text', text: '' }], stopReason: 'pending' } });
        send({ type: 'message_update', usage: ${JSON.stringify(ZERO_USAGE)}, assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: 'Working' } });
        return;
      }
      if (mode === 'crash') {
        process.exit(3);
      }
      if (mode === 'extension-dialog') {
        // A dialog with no timeout blocks the agent until it is answered.
        send({ type: 'extension_ui_request', id: 'ui-1', method: 'confirm', title: 'Run the dangerous step?' });
        return;
      }
      if (mode === 'utf8-split') {
        // A multi-byte character straddling two stdout chunks: chunk-local
        // decoding renders U+FFFD, a streaming decoder reassembles it.
        const line = JSON.stringify({
          type: 'message_update',
          usage: ${JSON.stringify(FINAL_USAGE)},
          assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: '你好世界' },
        });
        const bytes = Buffer.from(line + ${NEWLINE}, 'utf8');
        const splitAt = bytes.indexOf(Buffer.from('你', 'utf8')) + 1;
        process.stdout.write(bytes.subarray(0, splitAt));
        setTimeout(() => {
          process.stdout.write(bytes.subarray(splitAt));
          send({ type: 'agent_settled', aborted: false });
        }, 20);
        return;
      }
      if (mode === 'model-error') {
        // pi exits 0 even when the model call failed; the error only shows
        // up as stopReason/errorMessage on the assistant message.
        send({ type: 'agent_start' });
        send({ type: 'message_start', message: { role: 'assistant', content: [{ type: 'text', text: '' }], stopReason: 'pending' } });
        send({ type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: '' }], stopReason: 'error', errorMessage: '403 {"error":"forbidden"}' } });
        send({ type: 'agent_end', messages: [], willRetry: false });
        send({ type: 'agent_settled', aborted: false });
        return;
      }
      turn();
      return;
    case 'abort':
      // The real command answers once the session is idle.
      if (mode === 'hang') {
        turn({ aborted: true });
      }
      reply(command.id, 'abort');
      return;
    case 'extension_ui_response':
      if (process.env.PI_UI_RESPONSE_CAPTURE) {
        fs.writeFileSync(process.env.PI_UI_RESPONSE_CAPTURE, JSON.stringify(command));
      }
      if (mode === 'extension-dialog') {
        turn();
      }
      return;
    default:
      send({ type: 'response', command: 'parse', success: false, error: 'Unknown command ' + command.type });
  }
}

// Strict JSONL: records are split on LF only.
let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  const lines = buffer.split(${NEWLINE});
  buffer = lines.pop();
  for (const line of lines) {
    if (line.trim()) {
      handle(JSON.parse(line));
    }
  }
});
process.stdin.on('end', () => {
  // Orderly shutdown: stdin EOF means the client is done.
  note('exit ' + process.pid);
  process.exit(0);
});
`, 'utf8');

  if (process.platform === 'win32') {
    const commandPath = path.join(binDir, 'pi.cmd');
    await writeFile(commandPath, '@echo off\r\nnode "%~dp0pi.js" %*\r\n', 'utf8');
    return;
  }

  const commandPath = path.join(binDir, 'pi');
  await writeFile(commandPath, '#!/bin/sh\nnode "$(dirname "$0")/pi.js" "$@"\n', 'utf8');
  await chmod(commandPath, 0o755);
}

function createWriter(
  messages: NormalizedMessage[],
): ProviderRuntimeWriter & { setSessionIdCalls: number; sessionId: string | null } {
  const writer: ProviderRuntimeWriter & { setSessionIdCalls: number; sessionId: string | null } = {
    userId: null,
    sessionId: null,
    setSessionIdCalls: 0,
    send(message: NormalizedMessage) {
      messages.push(message);
    },
    setSessionId(sessionId: string) {
      this.setSessionIdCalls += 1;
      this.sessionId = sessionId;
    },
  };
  return writer;
}

/** Environment knobs the tests share with the fake, restored after each run. */
const FAKE_ENV_KEYS = ['PI_EVENT_MODE', 'PI_ARGS_CAPTURE', 'PI_COMMAND_LOG', 'PI_UI_RESPONSE_CAPTURE'] as const;

async function withFakePiOnPath(mode: string, fn: (tempRoot: string) => Promise<void>): Promise<void> {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'pi-rpc-'));
  const pathKey = findEnvKey('PATH');
  const pathExtKey = findEnvKey('PATHEXT');
  const previousPath = process.env[pathKey];
  const previousPathExt = process.env[pathExtKey];
  const previousFakeEnv = new Map(FAKE_ENV_KEYS.map((key) => [key, process.env[key]]));

  try {
    if (mode !== 'missing') {
      await writeFakePi(tempRoot);
    }
    // "missing" swaps PATH for an empty dir: prepending would still resolve a
    // real `pi` installed further down PATH, and the ENOENT contract needs the
    // lookup to actually fail.
    process.env[pathKey] = mode === 'missing'
      ? tempRoot
      : `${tempRoot}${path.delimiter}${previousPath || ''}`;
    process.env.PI_EVENT_MODE = mode;
    process.env.PI_COMMAND_LOG = path.join(tempRoot, 'commands.log');
    if (process.platform === 'win32') {
      process.env[pathExtKey] = previousPathExt?.toUpperCase().includes('.CMD')
        ? previousPathExt
        : `.COM;.EXE;.BAT;.CMD${previousPathExt ? `;${previousPathExt}` : ''}`;
    }
    return await fn(tempRoot);
  } finally {
    if (previousPath === undefined) {
      delete process.env[pathKey];
    } else {
      process.env[pathKey] = previousPath;
    }

    if (previousPathExt === undefined) {
      delete process.env[pathExtKey];
    } else {
      process.env[pathExtKey] = previousPathExt;
    }

    for (const [key, value] of previousFakeEnv) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }

    await rm(tempRoot, { recursive: true, force: true });
  }
}

/** Waits until the fake's command log contains a command, i.e. the run reached it. */
async function waitForCommand(tempRoot: string, command: string): Promise<void> {
  const logPath = path.join(tempRoot, 'commands.log');
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (existsSync(logPath) && (await readFile(logPath, 'utf8')).includes(command)) {
      return;
    }
    await sleep(25);
  }
  assert.fail(`the fake pi never received "${command}"`);
}

const readCommandLog = async (tempRoot: string): Promise<string> =>
  existsSync(path.join(tempRoot, 'commands.log')) ? readFile(path.join(tempRoot, 'commands.log'), 'utf8') : '';

const kinds = (messages: NormalizedMessage[]): string[] => messages.map((message) => message.kind);

test('buildPiArgs maps options onto the pi rpc invocation', () => {
  assert.deepEqual(buildPiArgs({}), ['--mode', 'rpc']);
  assert.deepEqual(buildPiArgs({ providerSessionId: '0198c0de-7a5b' }), ['--mode', 'rpc', '--session', '0198c0de-7a5b']);
  assert.deepEqual(buildPiArgs({ model: 'anthropic/claude-sonnet-4-20250514' }), ['--mode', 'rpc', '--model', 'anthropic/claude-sonnet-4-20250514']);
  // The prompt is a `prompt` command, not an argument, so a prompt that
  // starts with `-` needs no `--` guard any more.
  assert.deepEqual(buildPiArgs({ providerSessionId: 'abc', model: 'sonnet' }), ['--mode', 'rpc', '--session', 'abc', '--model', 'sonnet']);
});

test('handlePiRecord forwards session events, tracks usage and marks agent_settled', () => {
  const messages: NormalizedMessage[] = [];
  const forwarded: Array<[unknown, string | null]> = [];
  let usage: unknown = null;
  let settled = 0;
  const ctx = {
    ws: createWriter(messages),
    sessionId: 'app-1',
    getCapturedSessionId: () => 'provider-1',
    setUsage: (next: unknown) => { usage = next; },
    normalizeMessage: (raw: unknown, sessionId: string | null) => {
      forwarded.push([raw, sessionId]);
      return mapPiEventToMessages(raw, sessionId);
    },
    respond: () => assert.fail('a session event needs no answer'),
    markSettled: () => { settled += 1; },
  };

  handlePiRecord({ type: 'message_update', usage: FINAL_USAGE, assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: 'Hi' } }, ctx);
  assert.deepEqual(kinds(messages), ['stream_delta']);
  assert.equal(usage, FINAL_USAGE);
  // The provider-native id is preferred over the app id once it is known.
  assert.equal(forwarded[0]?.[1], 'provider-1');

  handlePiRecord({ type: 'agent_end', messages: [] }, ctx);
  assert.equal(settled, 0, 'agent_end only closes one low-level run');

  handlePiRecord({ type: 'agent_settled', aborted: false }, ctx);
  assert.equal(settled, 1);
  assert.equal(messages.at(-1)?.kind, 'stream_delta');
});

test('handlePiRecord cancels an extension dialog at once and tells the user why', () => {
  const messages: NormalizedMessage[] = [];
  const responses: Record<string, unknown>[] = [];
  handlePiRecord({ type: 'extension_ui_request', id: 'ui-1', method: 'confirm', title: 'Run the dangerous step?' }, {
    ws: createWriter(messages),
    sessionId: 'app-1',
    getCapturedSessionId: () => 'provider-1',
    setUsage: () => {},
    normalizeMessage: (raw, sessionId) => mapPiEventToMessages(raw, sessionId),
    respond: (response) => responses.push(response),
    markSettled: () => {},
  });
  assert.deepEqual(responses, [{ type: 'extension_ui_response', id: 'ui-1', cancelled: true }]);
  assert.equal(messages.length, 1);
  assert.equal(messages[0]?.kind, 'error');
  assert.match(String(messages[0]?.content), /pi extension asked for input \(confirm: "Run the dangerous step\?"\)/);
  assert.equal(messages[0]?.sessionId, 'provider-1');

  // Fire-and-forget UI records and unmatched responses draw nothing.
  const quiet: NormalizedMessage[] = [];
  const ctx = {
    ws: createWriter(quiet),
    sessionId: 'app-1',
    getCapturedSessionId: () => null,
    setUsage: () => {},
    normalizeMessage: (raw: unknown, sessionId: string | null) => mapPiEventToMessages(raw, sessionId),
    respond: () => assert.fail('nothing to answer'),
    markSettled: () => {},
  };
  handlePiRecord({ type: 'extension_ui_request', id: 'ui-2', method: 'setWidget', widget: {} }, ctx);
  handlePiRecord({ type: 'extension_ui_request', method: 'select', title: 'no id' }, ctx);
  handlePiRecord({ type: 'response', id: 'late', command: 'get_state', success: true }, ctx);
  handlePiRecord({ type: 'unparseable', line: 'some extension log' }, ctx);
  assert.deepEqual<NormalizedMessage[]>(quiet, []);

  // A response nobody awaits is only worth a row when it is a rejection.
  handlePiRecord({ type: 'response', command: 'parse', success: false, error: 'Failed to parse command' }, ctx);
  assert.deepEqual(kinds(quiet), ['error']);
  assert.match(String(quiet[0]?.content), /Failed to parse command/);
});

test('run emits session_created, stream deltas and exactly one terminal complete', async () => {
  const messages: NormalizedMessage[] = [];
  await withFakePiOnPath('replay', async (tempRoot) => {
    const argsCapturePath = path.join(tempRoot, 'pi-args.json');
    process.env.PI_ARGS_CAPTURE = argsCapturePath;
    const writer = createWriter(messages);

    await piRuntime.run('Say hi', { sessionId: 'app-1', cwd: tempRoot }, writer, makeRuntimeContext());

    const args: string[] = JSON.parse(await readFile(argsCapturePath, 'utf8'));
    assert.deepEqual(args, ['--mode', 'rpc']);

    // The provider session is announced once, before any content event, and
    // the writer is told the id through both channels.
    assert.deepEqual(kinds(messages), ['session_created', 'stream_delta', 'stream_delta', 'stream_end', 'status', 'complete']);
    assert.equal(messages[0]?.newSessionId, FAKE_SESSION_ID);
    assert.equal(writer.setSessionIdCalls, 1);
    assert.equal(writer.sessionId, FAKE_SESSION_ID);
    assert.ok(messages[1]?.sessionId === FAKE_SESSION_ID);

    // pi's last cumulative usage is the run's accounting.
    const budget = messages.find((message) => message.kind === 'status');
    assert.equal(budget?.text, 'token_budget');
    assert.deepEqual(budget?.tokenBudget, {
      used: 1620,
      inputTokens: 1474 + 128,
      outputTokens: 18,
      breakdown: { input: 1474 + 128, output: 18 },
      totalTokens: 1620,
      cost: 0.003,
    });

    const completes = messages.filter((message) => message.kind === 'complete');
    assert.equal(completes.length, 1);
    assert.equal(completes[0]?.success, true);
    assert.equal(completes[0]?.exitCode, 0);
    assert.equal(completes[0]?.actualSessionId, FAKE_SESSION_ID);
    assert.equal(isPiSessionActive('app-1'), false);

    // Orderly shutdown: the fake exits on stdin EOF, so its log records the
    // exit rather than the child being cut short.
    const log = await readCommandLog(tempRoot);
    assert.match(log, new RegExp(`exit ${readPids(log)[0]}`));
  });
});

/** The pids the fake logged as spawned, in order. */
function readPids(log: string): number[] {
  return log.split('\n').filter((line) => line.startsWith('spawn ')).map((line) => Number(line.split(' ')[1]));
}

test('run resumes with --session and does not re-announce an existing session', async () => {
  const messages: NormalizedMessage[] = [];
  await withFakePiOnPath('replay', async (tempRoot) => {
    const argsCapturePath = path.join(tempRoot, 'pi-args.json');
    process.env.PI_ARGS_CAPTURE = argsCapturePath;
    const writer = createWriter(messages);

    await piRuntime.run('Say hi', { sessionId: 'app-2', cwd: tempRoot, model: 'openai/gpt-5' }, writer, makeRuntimeContext({
      resolveProviderSessionId: () => FAKE_SESSION_ID,
    }));

    assert.deepEqual(JSON.parse(await readFile(argsCapturePath, 'utf8')), ['--mode', 'rpc', '--session', FAKE_SESSION_ID, '--model', 'openai/gpt-5']);
    // An existing session is not announced again; its id was known before
    // the run, so the writer is not re-told either (same as before).
    assert.equal(messages.some((message) => message.kind === 'session_created'), false);
    assert.equal(writer.setSessionIdCalls, 0);
    // Streamed rows carry the provider-native id; the terminal complete is
    // addressed to the app session, with the native id alongside.
    const streamed = messages.filter((message) => message.kind === 'stream_delta' || message.kind === 'stream_end');
    assert.ok(streamed.length > 0 && streamed.every((message) => message.sessionId === FAKE_SESSION_ID));
    const completes = messages.filter((message) => message.kind === 'complete');
    assert.equal(completes.length, 1);
    assert.equal(completes[0]?.sessionId, 'app-2');
    assert.equal(completes[0]?.actualSessionId, FAKE_SESSION_ID);
  });
});

test('run resolves successfully when the model errored', async () => {
  const messages: NormalizedMessage[] = [];
  await withFakePiOnPath('model-error', async (tempRoot) => {
    await piRuntime.run('Say hi', { sessionId: 'app-model-error', cwd: tempRoot }, createWriter(messages), makeRuntimeContext());

    // The failed turn is one error row, reported in-band by the event
    // stream, and the run itself ends well: pi settled normally.
    assert.equal(messages.filter((message) => message.kind === 'error').length, 1);
    assert.match(String(messages.find((message) => message.kind === 'error')?.content), /403/);
    const completes = messages.filter((message) => message.kind === 'complete');
    assert.equal(completes.length, 1);
    assert.equal(completes[0]?.success, true);
  });
});

test('run ignores non-protocol lines on stdout and still completes once', async () => {
  const messages: NormalizedMessage[] = [];
  await withFakePiOnPath('garbage', async (tempRoot) => {
    await piRuntime.run('Say hi', { sessionId: 'app-garbage', cwd: tempRoot }, createWriter(messages), makeRuntimeContext());

    // Stdout is reserved for protocol records; a stray log line is not
    // passed off as model output.
    assert.equal(messages.some((message) => message.kind === 'stream_delta' && String(message.content).includes('partially written')), false);
    assert.equal(messages.filter((message) => message.kind === 'stream_delta').length, 2);
    assert.equal(messages.filter((message) => message.kind === 'complete').length, 1);
  });
});

test('run decodes multi-byte characters that span stdout chunks', async () => {
  const messages: NormalizedMessage[] = [];
  await withFakePiOnPath('utf8-split', async (tempRoot) => {
    await piRuntime.run('Say hi', { sessionId: 'app-utf8', cwd: tempRoot }, createWriter(messages), makeRuntimeContext());

    const deltas = messages.filter((message) => message.kind === 'stream_delta').map((message) => message.content);
    assert.deepEqual(deltas, ['你好世界']);
  });
});

test('abort during model resolution prevents the spawn entirely', async () => {
  const messages: NormalizedMessage[] = [];
  await withFakePiOnPath('replay', async (tempRoot) => {
    const argsCapturePath = path.join(tempRoot, 'pi-abort-resolve-args.json');
    process.env.PI_ARGS_CAPTURE = argsCapturePath;

    let releaseModelResolution!: () => void;
    const modelResolutionGate = new Promise<void>((release) => {
      releaseModelResolution = release;
    });
    const runPromise = piRuntime.run('Say hi', { sessionId: 'app-abort-resolve', cwd: tempRoot }, createWriter(messages), makeRuntimeContext({
      resolveResumeModel: async () => {
        await modelResolutionGate;
        return undefined;
      },
    }));
    let rejection: unknown = null;
    runPromise.catch((error) => {
      rejection = error;
    });

    // The run is reachable while its model is still resolving — this is the
    // window that used to report "not running" and then spawn anyway.
    assert.equal(isPiSessionActive('app-abort-resolve'), true);
    assert.equal(abortPiSession('app-abort-resolve'), true);

    releaseModelResolution();
    // Resolves (the gateway owns the aborted run's terminal complete) instead
    // of rejecting.
    await runPromise;

    // No child was ever launched: the fake pi's argv capture never appeared.
    assert.equal(existsSync(argsCapturePath), false);
    assert.equal(messages.length, 0);
    assert.equal(rejection, null);
    assert.equal(isPiSessionActive('app-abort-resolve'), false);
  });
});

test('a resolver failure after abort settles the run instead of rejecting', async () => {
  const messages: NormalizedMessage[] = [];
  await withFakePiOnPath('replay', async (tempRoot) => {
    const argsCapturePath = path.join(tempRoot, 'pi-abort-resolver-error-args.json');
    process.env.PI_ARGS_CAPTURE = argsCapturePath;

    const resolverError = new Error('model lookup failed');
    let failModelResolution!: (error: unknown) => void;
    const modelResolutionGate = new Promise<never>((_resolve, reject) => {
      failModelResolution = reject;
    });
    const runPromise = piRuntime.run('Say hi', { sessionId: 'app-abort-resolver-error', cwd: tempRoot }, createWriter(messages), makeRuntimeContext({
      resolveResumeModel: async () => {
        await modelResolutionGate;
        return undefined;
      },
    }));
    let rejection: unknown = null;
    runPromise.catch((error) => {
      rejection = error;
    });

    // Abort lands while the model is still resolving — the gateway has already
    // sent this run's terminal cancelled complete at that point.
    assert.equal(isPiSessionActive('app-abort-resolver-error'), true);
    assert.equal(abortPiSession('app-abort-resolver-error'), true);

    // The resolver then fails; the cancelled run must still settle as success.
    failModelResolution(resolverError);
    await runPromise;

    assert.equal(existsSync(argsCapturePath), false);
    assert.equal(messages.length, 0);
    assert.equal(rejection, null);
    assert.equal(isPiSessionActive('app-abort-resolver-error'), false);
  });
});

test('a clean abort resolves the run, stays silent and is never a failure', async () => {
  const messages: NormalizedMessage[] = [];
  await withFakePiOnPath('hang', async (tempRoot) => {
    const runPromise = piRuntime.run('Say hi', { sessionId: 'app-abort', cwd: tempRoot }, createWriter(messages), makeRuntimeContext());
    await waitForCommand(tempRoot, 'prompt');

    assert.equal(abortPiSession('app-abort'), true);
    // The run is settling, not gone: a repeated abort is harmless and true.
    assert.equal(abortPiSession('app-abort'), true);
    assert.equal(isPiSessionActive('app-abort'), true);

    // pi stops itself and reports agent_settled; the run resolves rather
    // than rejecting, so the gateway logs no failure for a user's abort.
    await runPromise;

    const log = await readCommandLog(tempRoot);
    // Both aborts reached pi; the run resolved only because pi then reported
    // agent_settled (a run left unsettled would have rejected).
    assert.match(log, /abort\nabort\n/);

    // The gateway (`chatRunRegistry.completeRun`) owns the single aborted
    // `complete` for cancelled runs; the runtime itself must stay silent here
    // or clients would see the run finish twice. No error rows either.
    assert.equal(messages.some((message) => message.kind === 'complete'), false);
    assert.equal(messages.some((message) => message.kind === 'error'), false);
    assert.ok(kinds(messages).includes('stream_delta'));
    assert.equal(isPiSessionActive('app-abort'), false);
  });
});

test('a run that ignores abort is terminated and rejected', { timeout: 30_000 }, async () => {
  const messages: NormalizedMessage[] = [];
  await withFakePiOnPath('hang-ignore-abort', async (tempRoot) => {
    const runPromise = piRuntime.run('Say hi', { sessionId: 'app-abort-ignored', cwd: tempRoot }, createWriter(messages), makeRuntimeContext());
    await waitForCommand(tempRoot, 'prompt');

    assert.equal(abortPiSession('app-abort-ignored'), true);

    // The grace period passes, the child is signalled, and the abort that
    // did not work is passed up for the log — still without a `complete`.
    await assert.rejects(runPromise, /did not report agent_settled after abort/);
    assert.equal(messages.some((message) => message.kind === 'complete'), false);
    assert.equal(isPiSessionActive('app-abort-ignored'), false);
  });
});

test('a second run on the same session waits for the aborted run to exit', { timeout: 30_000 }, async () => {
  const messages: NormalizedMessage[] = [];
  await withFakePiOnPath('hang', async (tempRoot) => {
    const first = piRuntime.run('Say hi', { sessionId: 'app-interrupt', cwd: tempRoot }, createWriter(messages), makeRuntimeContext());
    await waitForCommand(tempRoot, 'prompt');
    const [firstPid] = readPids(await readCommandLog(tempRoot));
    assert.ok(firstPid, 'the first run spawned a child');

    // `interruptActiveRun`: abort, then prompt again in the same breath. The
    // next run is an ordinary turn, so the fake settles it normally.
    assert.equal(abortPiSession('app-interrupt'), true);
    process.env.PI_EVENT_MODE = 'replay';
    const second = piRuntime.run('Now this', { sessionId: 'app-interrupt', cwd: tempRoot }, createWriter(messages), makeRuntimeContext());

    await Promise.all([first, second]);

    // The interrupted run's child had exited before the next one spawned:
    // two pi processes appending to one session file would interleave.
    const log = await readCommandLog(tempRoot);
    const secondPid = readPids(log)[1];
    assert.ok(secondPid, log);
    assert.ok(log.indexOf(`exit ${firstPid}`) < log.indexOf(`spawn ${secondPid}`), log);

    // Exactly one terminal complete belongs to the second run; the first was
    // completed by the gateway.
    assert.equal(messages.filter((message) => message.kind === 'complete').length, 1);
    assert.equal(isPiSessionActive('app-interrupt'), false);
  });
});

test('run rejects PROVIDER_NOT_INSTALLED when the CLI is missing', async () => {
  const messages: NormalizedMessage[] = [];
  await withFakePiOnPath('missing', async (tempRoot) => {
    await assert.rejects(
      piRuntime.run('Say hi', { sessionId: 'app-1', cwd: tempRoot }, createWriter(messages), makeRuntimeContext({
        isProviderInstalled: async () => false,
      })),
      (error) => {
        assert.ok(error instanceof AppError);
        assert.equal(error.code, 'PROVIDER_NOT_INSTALLED');
        assert.match(error.message, /Pi CLI is not installed/);
        return true;
      },
    );

    assert.equal(messages.filter((message) => message.kind === 'error').length, 1);
    const completes = messages.filter((message) => message.kind === 'complete');
    assert.equal(completes.length, 1);
    assert.equal(completes[0]?.success, false);
    assert.equal(isPiSessionActive('app-1'), false);
  });
});

test('a CLI that exits before answering is reported with its last stderr line', async () => {
  const messages: NormalizedMessage[] = [];
  await withFakePiOnPath('exit-early', async (tempRoot) => {
    let rejection: unknown = null;
    await piRuntime.run('Say hi', { sessionId: 'app-exit-early', cwd: tempRoot }, createWriter(messages), makeRuntimeContext()).catch((error) => {
      rejection = error;
    });

    assert.ok(rejection instanceof AppError);
    assert.equal((rejection as AppError).code, 'PI_RPC_CLOSED');
    assert.match((rejection as AppError).message, /exited \(code 2/);
    assert.match((rejection as AppError).message, /unknown option '--mode rpc'/);

    assert.equal(messages.filter((message) => message.kind === 'error').length, 1);
    assert.match(String(messages[0]?.content), /unknown option '--mode rpc'/);
    const completes = messages.filter((message) => message.kind === 'complete');
    assert.equal(completes.length, 1);
    assert.equal(completes[0]?.exitCode, 2);
    assert.equal(completes[0]?.success, false);
    assert.equal(isPiSessionActive('app-exit-early'), false);
  });
});

test('a rejected prompt is reported once and fails the run', async () => {
  const messages: NormalizedMessage[] = [];
  await withFakePiOnPath('reject-prompt', async (tempRoot) => {
    await assert.rejects(
      piRuntime.run('Say hi', { sessionId: 'app-reject', cwd: tempRoot }, createWriter(messages), makeRuntimeContext()),
      /Model not found: invalid\/model/,
    );

    assert.equal(messages.filter((message) => message.kind === 'error').length, 1);
    const completes = messages.filter((message) => message.kind === 'complete');
    assert.equal(completes.length, 1);
    assert.equal(completes[0]?.success, false);
  });
});

test('a child that crashes mid-run rejects and completes once with its exit code', async () => {
  const messages: NormalizedMessage[] = [];
  await withFakePiOnPath('crash', async (tempRoot) => {
    await assert.rejects(
      piRuntime.run('Say hi', { sessionId: 'app-crash', cwd: tempRoot }, createWriter(messages), makeRuntimeContext()),
      /exited \(code 3, signal null\) before the run finished/,
    );

    assert.equal(messages.filter((message) => message.kind === 'error').length, 1);
    const completes = messages.filter((message) => message.kind === 'complete');
    assert.equal(completes.length, 1);
    assert.equal(completes[0]?.exitCode, 3);
    assert.equal(completes[0]?.success, false);
    assert.equal(isPiSessionActive('app-crash'), false);
  });
});

test('an extension dialog is cancelled so the run goes on instead of hanging', async () => {
  const messages: NormalizedMessage[] = [];
  await withFakePiOnPath('extension-dialog', async (tempRoot) => {
    const responseCapture = path.join(tempRoot, 'ui-response.json');
    process.env.PI_UI_RESPONSE_CAPTURE = responseCapture;

    await piRuntime.run('Say hi', { sessionId: 'app-dialog', cwd: tempRoot }, createWriter(messages), makeRuntimeContext());

    assert.deepEqual(JSON.parse(await readFile(responseCapture, 'utf8')), { type: 'extension_ui_response', id: 'ui-1', cancelled: true });
    const errors = messages.filter((message) => message.kind === 'error');
    assert.equal(errors.length, 1);
    assert.match(String(errors[0]?.content), /asked for input \(confirm: "Run the dangerous step\?"\)/);
    // The turn the dialog was blocking still ran to its end.
    assert.equal(messages.filter((message) => message.kind === 'complete').length, 1);
    assert.ok(kinds(messages).includes('stream_delta'));
  });
});

test('a legacy caller without a session id can abort by the provider id', async () => {
  const messages: NormalizedMessage[] = [];
  await withFakePiOnPath('hang', async (tempRoot) => {
    const runPromise = piRuntime.run('Say hi', { cwd: tempRoot }, createWriter(messages), makeRuntimeContext({
      resolveProviderSessionId: () => null,
    }));
    await waitForCommand(tempRoot, 'prompt');
    assert.equal(writerSession(messages), FAKE_SESSION_ID);

    assert.equal(abortPiSession(FAKE_SESSION_ID), true);
    await runPromise;
    assert.equal(messages.some((message) => message.kind === 'complete'), false);
  });
});

function writerSession(messages: NormalizedMessage[]): string | null {
  return messages.find((message) => message.kind === 'session_created')?.newSessionId ?? null;
}

test('an attachment-only prompt is sent without a command', async () => {
  const messages: NormalizedMessage[] = [];
  await withFakePiOnPath('replay', async (tempRoot) => {
    await piRuntime.run('', { sessionId: 'app-files', cwd: tempRoot, files: [{ path: path.join(tempRoot, 'notes.txt') }] }, createWriter(messages), makeRuntimeContext());

    const log = await readCommandLog(tempRoot);
    assert.match(log, /prompt/);
    assert.equal(messages.filter((message) => message.kind === 'complete').length, 1);
  });
});
