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
  isPiSessionActive,
  piRuntime,
  processPiOutputLine,
} from './pi-runtime.provider.js';
import { mapPiEventToMessages } from './pi-sessions.provider.js';

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

// The runtime contract only cares that normalizeMessage maps one raw pi event
// onto zero or more normalized messages, so the context wires the sessions
// facet's real mapping — the same one the live provider registry serves.
const makeRuntimeContext = (overrides: Partial<ProviderRuntimeContext> = {}): ProviderRuntimeContext => ({
  resolveProviderSessionId: (sessionId) => sessionId || null,
  resolveResumeModel: async (_sessionId, requestedModel) => requestedModel || undefined,
  getProviderModels: async () => ({ OPTIONS: [], DEFAULT: '' }),
  normalizeMessage: (raw, sessionId) => mapPiEventToMessages(raw, sessionId),
  isProviderInstalled: async () => true,
  ...overrides,
});

// Fake event stream copied from a recorded `pi -p --mode json` transcript
// (pi 0.85.1). Field shapes are the protocol facts that both the runtime and
// the sessions normalizer build on.
const FAKE_SESSION_ID = '0198c0de-7a5b-7f3e-9a1c-3d2e4f5a6b7c';
const FINAL_USAGE = {
  input: 1474,
  output: 18,
  cacheRead: 128,
  cacheWrite: 0,
  totalTokens: 1620,
  cost: { input: 0.001, output: 0.002, total: 0.003 },
};
const FAKE_EVENTS = [
  {
    type: 'session',
    version: 3,
    id: FAKE_SESSION_ID,
    timestamp: '2026-09-12T13:52:05.003Z',
    cwd: process.cwd(),
  },
  { type: 'agent_start' },
  { type: 'turn_start' },
  {
    type: 'message_start',
    message: { role: 'user', content: [{ type: 'text', text: 'Say hi' }] },
  },
  {
    type: 'message_end',
    message: { role: 'user', content: [{ type: 'text', text: 'Say hi' }] },
  },
  {
    type: 'message_start',
    message: {
      role: 'assistant',
      content: [{ type: 'text', text: '', stopReason: 'pending' }],
    },
  },
  {
    type: 'message_update',
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 },
    assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: 'Hello' },
  },
  {
    type: 'message_update',
    usage: FINAL_USAGE,
    assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: ' world' },
  },
  {
    type: 'message_end',
    message: {
      role: 'assistant',
      content: [{ type: 'text', text: 'Hello world' }],
      stopReason: 'stop',
      usage: FINAL_USAGE,
    },
  },
  { type: 'turn_end' },
  { type: 'agent_end', messages: [] },
  { type: 'agent_settled' },
];

const findEnvKey = (name: string): string =>
  Object.keys(process.env).find((key) => key.toLowerCase() === name.toLowerCase()) || name;

async function writeFakePi(binDir: string, { mode = 'replay' }: { mode?: string } = {}): Promise<void> {
  const scriptPath = path.join(binDir, 'pi.js');
  await writeFile(scriptPath, `
const fs = require('node:fs');
const capturePath = process.env.PI_ARGS_CAPTURE;
const args = process.argv.slice(2);
if (capturePath) {
  fs.writeFileSync(capturePath, JSON.stringify(args));
}

// Resume runs keep the same session id, so the fake echoes the requested
// --session value back in the header; new runs mint a fixed one.
const sessionFlagIndex = args.indexOf('--session');
const headerId = sessionFlagIndex >= 0 ? args[sessionFlagIndex + 1] : ${JSON.stringify(FAKE_SESSION_ID)};
const header = JSON.stringify({
  type: 'session',
  version: 3,
  id: headerId,
  timestamp: '2026-09-12T13:52:05.003Z',
  cwd: process.cwd(),
});

const mode = process.env.PI_EVENT_MODE || '${mode}';
if (mode === 'hang') {
  console.log(header);
  // Long-running turn: no further output, process stays alive until killed.
  setTimeout(() => {}, 30_000);
} else if (mode === 'garbage') {
  console.log('pi: warning: partially written line');
} else if (mode === 'utf8-split') {
  // A multi-byte character straddling two stdout chunks: chunk-local decoding
  // renders U+FFFD, a streaming decoder reassembles it.
  const line = JSON.stringify({
    type: 'message_update',
    usage: ${JSON.stringify(FINAL_USAGE)},
    assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: '你好世界' },
  });
  const bytes = Buffer.from(line + '\\n', 'utf8');
  const splitAt = bytes.indexOf(Buffer.from('你', 'utf8')) + 1;
  process.stdout.write(bytes.subarray(0, splitAt));
  setTimeout(() => {
    process.stdout.write(bytes.subarray(splitAt));
  }, 20);
} else if (mode === 'model-error') {
  // pi exits 0 even when the model call failed; the error only shows up as
  // stopReason/errorMessage on the assistant message (verified against
  // pi 0.85.1).
  console.log(header);
  console.log(JSON.stringify({ type: 'agent_start' }));
  console.log(JSON.stringify({
    type: 'message_start',
    message: { role: 'assistant', content: [{ type: 'text', text: '', stopReason: 'pending' }] },
  }));
  console.log(JSON.stringify({
    type: 'message_end',
    message: { role: 'assistant', content: [{ type: 'text', text: '' }], stopReason: 'error', errorMessage: '403 {"error":"forbidden"}' },
  }));
  console.log(JSON.stringify({ type: 'agent_end', messages: [], willRetry: false }));
  console.log(JSON.stringify({ type: 'agent_settled' }));
} else {
  const events = ${JSON.stringify(FAKE_EVENTS)}.map((event) => JSON.stringify(event));
  console.log([header].concat(events.slice(1)).join('\\n'));
}
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

async function withFakePiOnPath(mode: string, fn: (tempRoot: string) => Promise<void>): Promise<void> {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'pi-cli-'));
  const pathKey = findEnvKey('PATH');
  const pathExtKey = findEnvKey('PATHEXT');
  const previousPath = process.env[pathKey];
  const previousPathExt = process.env[pathExtKey];
  const previousArgsCapture = process.env.PI_ARGS_CAPTURE;
  const previousMode = process.env.PI_EVENT_MODE;

  try {
    if (mode !== 'missing') {
      await writeFakePi(tempRoot, { mode });
    }
    // "missing" swaps PATH for an empty dir: prepending would still resolve a
    // real `pi` installed further down PATH, and the ENOENT contract needs the
    // lookup to actually fail.
    process.env[pathKey] = mode === 'missing'
      ? tempRoot
      : `${tempRoot}${path.delimiter}${previousPath || ''}`;
    process.env.PI_EVENT_MODE = mode;
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

    if (previousArgsCapture === undefined) {
      delete process.env.PI_ARGS_CAPTURE;
    } else {
      process.env.PI_ARGS_CAPTURE = previousArgsCapture;
    }

    if (previousMode === undefined) {
      delete process.env.PI_EVENT_MODE;
    } else {
      process.env.PI_EVENT_MODE = previousMode;
    }

    await rm(tempRoot, { recursive: true, force: true });
  }
}

test('buildPiArgs maps options onto the pi print/json invocation', () => {
  assert.deepEqual(
    buildPiArgs({ providerSessionId: 'abc', model: 'anthropic/claude-sonnet-4', prompt: 'hi' }),
    ['-p', '--mode', 'json', '--session', 'abc', '--model', 'anthropic/claude-sonnet-4', '--', 'hi'],
  );
  assert.deepEqual(buildPiArgs({ prompt: 'hi' }), ['-p', '--mode', 'json', '--', 'hi']);
  // A prompt that begins with '-' stays positional behind the `--` guard.
  assert.deepEqual(
    buildPiArgs({ prompt: '--dangerous-looking prompt' }),
    ['-p', '--mode', 'json', '--', '--dangerous-looking prompt'],
  );
  // Attachment-only runs send no positional prompt at all.
  assert.deepEqual(buildPiArgs({}), ['-p', '--mode', 'json']);
});

test('spawnPi emits session_created, stream deltas and exactly one terminal complete', async () => {
  const messages: NormalizedMessage[] = [];
  let argsCapturePath = '';
  await withFakePiOnPath('replay', async (tempRoot) => {
    argsCapturePath = path.join(tempRoot, 'pi-args.json');
    process.env.PI_ARGS_CAPTURE = argsCapturePath;
    const writer = createWriter(messages);
    // pi has no permission system: permissionMode/effort must be ignored.
    await piRuntime.run(
      'Say hi',
      {
        sessionId: 'app-1',
        cwd: tempRoot,
        // Spread on purpose: pi has no permission/effort levers, so unknown
        // pass-through options must be ignored, not type-error the caller.
        ...({ permissionMode: 'bypassPermissions', effort: 'high' } as Record<string, unknown>),
      },
      writer,
      makeRuntimeContext({ resolveProviderSessionId: () => null }),
    );

    const kinds = messages.map((message) => message.kind);
    const complete = messages.find((message) => message.kind === 'complete');

    assert.equal(messages[0].kind, 'session_created');
    assert.equal(messages[0].newSessionId, FAKE_SESSION_ID);
    assert.equal(writer.setSessionIdCalls, 1);
    assert.equal(writer.sessionId, FAKE_SESSION_ID);

    const sessionCreatedIndex = kinds.indexOf('session_created');
    const firstDeltaIndex = kinds.indexOf('stream_delta');
    assert.ok(firstDeltaIndex > sessionCreatedIndex);
    assert.deepEqual(
      messages.filter((message) => message.kind === 'stream_delta').map((message) => message.content),
      ['Hello', ' world'],
    );

    // Exactly one terminal complete, and it closes the run.
    assert.equal(kinds.filter((kind) => kind === 'complete').length, 1);
    const lastMessage = messages.at(-1);
    assert.ok(lastMessage);
    assert.equal(lastMessage.kind, 'complete');
    assert.equal(complete?.success, true);
    assert.equal(complete?.aborted, false);
    assert.equal(complete?.actualSessionId, FAKE_SESSION_ID);
    assert.equal(messages.some((message) => message.kind === 'error'), false);

    // Last recorded usage (from message_update) feeds the token budget before complete.
    const tokenBudgetIndex = kinds.indexOf('status');
    assert.ok(tokenBudgetIndex > -1 && tokenBudgetIndex < kinds.indexOf('complete'));
    const tokenBudgetMessage = messages[tokenBudgetIndex];
    assert.equal(tokenBudgetMessage.text, 'token_budget');
    const budget = tokenBudgetMessage.tokenBudget as {
      used: number;
      inputTokens: number;
      outputTokens: number;
      cost?: number;
    };
    assert.equal(budget.used, FINAL_USAGE.totalTokens);
    assert.equal(budget.inputTokens, FINAL_USAGE.input + FINAL_USAGE.cacheRead);
    assert.equal(budget.outputTokens, FINAL_USAGE.output);
    assert.equal(budget.cost, FINAL_USAGE.cost.total);

    const launchedArgs = JSON.parse(await readFile(argsCapturePath, 'utf8')) as string[];
    assert.deepEqual(launchedArgs.slice(0, 3), ['-p', '--mode', 'json']);
    // pi has no --dir flag; the working directory is the spawn cwd option.
    assert.equal(launchedArgs.includes('--dir'), false);
    // pi has no permission/effort levers: those options map to no flag at all.
    assert.equal(launchedArgs.includes('--auto'), false);
    assert.equal(launchedArgs.includes('--agent'), false);
    assert.equal(launchedArgs.includes('--variant'), false);
    // The prompt rides behind `--` and stays the final positional argument.
    const promptGuardIndex = launchedArgs.indexOf('--');
    assert.ok(promptGuardIndex > -1);
    assert.equal(launchedArgs.at(-1), 'Say hi');
  });
});

test('spawnPi resumes with --session and does not re-announce an existing session', async () => {
  const messages: NormalizedMessage[] = [];
  await withFakePiOnPath('replay', async (tempRoot) => {
    const argsCapturePath = path.join(tempRoot, 'pi-resume-args.json');
    process.env.PI_ARGS_CAPTURE = argsCapturePath;
    const writer = createWriter(messages);

    await piRuntime.run(
      'Continue',
      { sessionId: 'app-1', cwd: tempRoot },
      writer,
      makeRuntimeContext({ resolveProviderSessionId: () => 'existing-session' }),
    );

    assert.equal(messages.some((message) => message.kind === 'session_created'), false);
    assert.equal(writer.setSessionIdCalls, 0);
    assert.equal(messages.filter((message) => message.kind === 'complete').length, 1);

    const launchedArgs = JSON.parse(await readFile(argsCapturePath, 'utf8')) as string[];
    const sessionIndex = launchedArgs.indexOf('--session');
    assert.ok(sessionIndex > -1);
    assert.equal(launchedArgs[sessionIndex + 1], 'existing-session');
  });
});

test('spawnPi resolves successfully when the model errored but pi exited 0', async () => {
  const messages: NormalizedMessage[] = [];
  await withFakePiOnPath('model-error', async (tempRoot) => {
    const writer = createWriter(messages);
    await piRuntime.run('Say hi', { sessionId: 'app-1', cwd: tempRoot }, writer, makeRuntimeContext());

    // Exit code 0 is not success evidence for pi, but the runtime treats the
    // process lifecycle only; error mapping belongs to normalizeMessage.
    assert.equal(messages.filter((message) => message.kind === 'complete').length, 1);
    const lastMessage = messages.at(-1);
    assert.ok(lastMessage);
    assert.equal(lastMessage.kind, 'complete');
    assert.equal(lastMessage.success, true);
  });
});

test('processPiOutputLine forwards non-JSON lines as stream deltas', () => {
  const messages: NormalizedMessage[] = [];
  const writer = createWriter(messages);
  processPiOutputLine('pi: warning: partially written line', {
    ws: writer,
    sessionId: 'app-1',
    getCapturedSessionId: () => null,
    registerSession: () => {},
    setUsage: () => {},
    normalizeMessage: mapPiEventToMessages,
  });

  assert.equal(messages.length, 1);
  assert.equal(messages[0].kind, 'stream_delta');
  assert.equal(messages[0].content, 'pi: warning: partially written line');
  assert.equal(messages[0].sessionId, 'app-1');
});

test('spawnPi keeps stdout non-JSON lines streaming and still completes once', async () => {
  const messages: NormalizedMessage[] = [];
  await withFakePiOnPath('garbage', async (tempRoot) => {
    const writer = createWriter(messages);
    await piRuntime.run('Say hi', { sessionId: 'app-1', cwd: tempRoot }, writer, makeRuntimeContext());

    assert.deepEqual(
      messages.filter((message) => message.kind === 'stream_delta').map((message) => message.content),
      ['pi: warning: partially written line'],
    );
    assert.equal(messages.filter((message) => message.kind === 'complete').length, 1);
  });
});

test('spawnPi decodes multi-byte characters that span stdout chunks', async () => {
  const messages: NormalizedMessage[] = [];
  await withFakePiOnPath('utf8-split', async (tempRoot) => {
    const writer = createWriter(messages);
    await piRuntime.run('Say hi', { sessionId: 'app-utf8', cwd: tempRoot }, writer, makeRuntimeContext());

    // The delta arrives as one intact text run — not as a mangled JSON line
    // routed through the non-JSON fallback.
    assert.deepEqual(
      messages.filter((message) => message.kind === 'stream_delta').map((message) => message.content),
      ['你好世界'],
    );
    assert.equal(JSON.stringify(messages).includes('\uFFFD'), false);
    assert.equal(messages.filter((message) => message.kind === 'complete').length, 1);
  });
});

test('abort during model resolution prevents the spawn entirely', async () => {
  const messages: NormalizedMessage[] = [];
  await withFakePiOnPath('replay', async (tempRoot) => {
    const argsCapturePath = path.join(tempRoot, 'pi-abort-resolve-args.json');
    process.env.PI_ARGS_CAPTURE = argsCapturePath;
    const writer = createWriter(messages);

    let releaseModelResolution!: () => void;
    const modelResolutionGate = new Promise<void>((release) => {
      releaseModelResolution = release;
    });
    const runPromise = piRuntime.run('Say hi', { sessionId: 'app-abort-resolve', cwd: tempRoot }, writer, makeRuntimeContext({
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
    assert.equal(abortPiSession('app-abort-resolve'), false);

    releaseModelResolution();
    // Resolves (the gateway owns the aborted run's terminal complete) instead
    // of rejecting.
    await runPromise;

    // No child was ever launched: the fake pi's argv capture never appeared.
    assert.equal(existsSync(argsCapturePath), false);
    // The aborted run sends nothing itself.
    assert.equal(messages.length, 0);
    assert.equal(rejection, null);
    assert.equal(isPiSessionActive('app-abort-resolve'), false);
  });
});

test('abortPiSession kills the run, suppresses the runtime complete and rejects once', async () => {
  const messages: NormalizedMessage[] = [];
  await withFakePiOnPath('hang', async (tempRoot) => {
    const argsCapturePath = path.join(tempRoot, 'pi-abort-args.json');
    process.env.PI_ARGS_CAPTURE = argsCapturePath;
    const writer = createWriter(messages);
    const runPromise = piRuntime.run('Say hi', { sessionId: 'app-abort', cwd: tempRoot }, writer, makeRuntimeContext());
    // The gateway rejects the run promise too; swallow it until assert.rejects.
    let rejection: unknown = null;
    runPromise.catch((error) => {
      rejection = error;
    });

    // Poll until the child actually spawned (the fake writes its argv at
    // startup) and then abort. Aborting earlier would land on the pre-spawn
    // pending entry — that window has its own contract, covered above.
    for (let attempt = 0; attempt < 100 && !existsSync(argsCapturePath); attempt += 1) {
      await sleep(50);
    }
    assert.equal(existsSync(argsCapturePath), true);
    assert.equal(abortPiSession('app-abort'), true);
    // A second abort finds nothing running.
    assert.equal(abortPiSession('app-abort'), false);

    await assert.rejects(runPromise, /terminated|exited with code/);
    assert.ok(rejection instanceof Error);

    // The gateway (`chatRunRegistry.completeRun`) owns the single aborted
    // `complete` for cancelled runs; the runtime itself must stay silent here
    // or clients would see the run finish twice.
    assert.equal(messages.some((message) => message.kind === 'complete'), false);
  });
});

test('spawnPi rejects PROVIDER_NOT_INSTALLED when the CLI is missing', async () => {
  const messages: NormalizedMessage[] = [];
  await withFakePiOnPath('missing', async (tempRoot) => {
    const writer = createWriter(messages);
    await assert.rejects(
      piRuntime.run('Say hi', { sessionId: 'app-1', cwd: tempRoot }, writer, makeRuntimeContext({
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
    assert.equal(completes[0].success, false);
  });
});
