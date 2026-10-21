import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test, { after, before } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { opencodeRuntime } from '@/modules/providers/list/opencode/opencode-runtime.provider.js';
import { OpenCodeSessionsProvider } from '@/modules/providers/list/opencode/opencode-sessions.provider.js';
import { providerCapabilitiesService } from '@/modules/providers/services/provider-capabilities.service.js';
import type { AnyRecord, NormalizedMessage } from '@/shared/types.js';

/**
 * OpenCode chat turns run on a private `opencode serve` so OpenCode's
 * permission requests and the agent's questions reach the chat user (#1569).
 * Before, every turn ran `opencode run`, which rejected each request itself and
 * hid the question tool. These tests drive the real runtime adapter against a
 * fake `opencode` executable (fixtures/fake-opencode-serve.ts) that emulates
 * the server's HTTP API and event stream and records every request it gets.
 */

const TESTS_DIR = path.dirname(fileURLToPath(import.meta.url));
const FAKE_OPENCODE = path.join(TESTS_DIR, 'fixtures', 'fake-opencode-serve.ts');
const SERVER_PROCESS_MODULE = path.resolve(TESTS_DIR, '..', 'list', 'opencode', 'opencode-server.process.ts');
const APPLICATION_ROOT = path.resolve(TESTS_DIR, '..', '..', '..', '..');
// The fake is TypeScript; node runs it with tsx's loader, as the tests run.
const TSX_LOADER = import.meta.resolve('tsx');
// A turn that has not finished by then is stuck; it is aborted so the suite
// fails instead of hanging.
const TURN_DEADLINE_MS = 20_000;
// Execs its arguments as a child subreaper (prctl PR_SET_CHILD_SUBREAPER):
// orphaned descendants are reparented to that process, and a Node process
// never reaps children it did not spawn, like a container's PID 1 without an
// init.
const EXEC_AS_SUBREAPER_PY = [
  'import ctypes, os, sys',
  'if ctypes.CDLL(None, use_errno=True).prctl(36, 1, 0, 0, 0) != 0: sys.exit(70)',
  'os.execv(sys.argv[1], sys.argv[1:])',
].join('\n');
const CAN_EXEC_AS_SUBREAPER = process.platform === 'linux'
  && spawnSync('python3', ['-c', EXEC_AS_SUBREAPER_PY, '/bin/true'], { stdio: 'ignore' }).status === 0;

const sessionsProvider = new OpenCodeSessionsProvider();
const providerSessionIds = new Map<string, string>();
const runtimeContext = {
  resolveProviderSessionId: (sessionId: string | null | undefined) =>
    (sessionId ? providerSessionIds.get(sessionId) : undefined) ?? null,
  resolveResumeModel: async (_sessionId: string | undefined, requestedModel?: string | null) =>
    requestedModel || undefined,
  getProviderModels: async () => ({ OPTIONS: [], DEFAULT: '' }),
  normalizeMessage: (raw: unknown, sessionId: string | null) => sessionsProvider.normalizeMessage(raw, sessionId),
  isProviderInstalled: async () => true,
};

const findEnvKey = (name: string) =>
  Object.keys(process.env).find((key) => key.toLowerCase() === name.toLowerCase()) || name;

let tempRoot = '';
let projectDir = '';
let binDir = '';
/** POSIX only: an `opencode` that is a wrapper script around the fake (see writeShim). */
let wrapperBinDir = '';
let runCounter = 0;
const savedEnv = new Map<string, string | undefined>();
/** Every fake server pid seen, so none can outlive the suite. */
const fakePids = new Set<number>();

function setEnv(name: string, value: string | undefined): void {
  if (!savedEnv.has(name)) {
    savedEnv.set(name, process.env[name]);
  }
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

before(async () => {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), 'opencode-serve-runtime-'));
  projectDir = path.join(tempRoot, 'project');
  binDir = path.join(tempRoot, 'bin');
  const homeDir = path.join(tempRoot, 'home');
  await mkdir(projectDir, { recursive: true });
  await mkdir(binDir, { recursive: true });
  await mkdir(homeDir, { recursive: true });

  if (process.platform === 'win32') {
    await writeFile(
      path.join(binDir, 'opencode.cmd'),
      `@echo off\r\n"${process.execPath}" --import "${TSX_LOADER}" "${FAKE_OPENCODE}" %*\r\n`,
      'utf8',
    );
    const pathExtKey = findEnvKey('PATHEXT');
    const pathExt = process.env[pathExtKey];
    setEnv(pathExtKey, pathExt?.toUpperCase().includes('.CMD') ? pathExt : `.COM;.EXE;.BAT;.CMD${pathExt ? `;${pathExt}` : ''}`);
  } else {
    await writeShim(binDir, 'exec');
    wrapperBinDir = path.join(tempRoot, 'bin-wrapper');
    await mkdir(wrapperBinDir, { recursive: true });
    await writeShim(wrapperBinDir, 'wrap');
  }

  const pathKey = findEnvKey('PATH');
  setEnv(pathKey, `${binDir}${path.delimiter}${process.env[pathKey] || ''}`);
  // Token usage is read from ~/.local/share/opencode; keep it (and any app DB)
  // away from the real home directory.
  setEnv('HOME', homeDir);
  setEnv('USERPROFILE', homeDir);
  setEnv('DATABASE_PATH', path.join(tempRoot, 'auth.db'));
  setEnv('OPENCODE_PERMISSION', undefined);
  // The fake runs in the project directory; a relative tsconfig path (the
  // test runner's) would not resolve there.
  setEnv('TSX_TSCONFIG_PATH', path.join(APPLICATION_ROOT, 'server', 'tsconfig.json'));
});

after(async () => {
  for (const pid of fakePids) {
    killProcessGroup(pid);
  }
  for (const [name, value] of savedEnv) {
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }
  await rm(tempRoot, { recursive: true, force: true });
});

type CaptureEntry = {
  pid: number;
  kind: 'spawn' | 'request' | 'exit' | 'crash' | 'sigterm-ignored';
  argv?: string[];
  permissionEnv?: string | null;
  hasPassword?: boolean;
  method?: string;
  path?: string;
  directory?: string | null;
  authorized?: boolean;
  body?: AnyRecord | null;
  signal?: string;
};

/**
 * The `opencode` shim on PATH. `exec` replaces the shell with the fake, as an
 * npm-installed native binary does; `wrap` keeps the shell as the parent of
 * the fake, as an install whose `opencode` is a wrapper script does.
 */
async function writeShim(directory: string, mode: 'exec' | 'wrap', delaySeconds = 0): Promise<void> {
  const shimPath = path.join(directory, 'opencode');
  const run = `"${process.execPath}" --import "${TSX_LOADER}" "${FAKE_OPENCODE}" "$@"`;
  const delay = delaySeconds > 0 ? `sleep ${delaySeconds}\n` : '';
  await writeFile(shimPath, `#!/bin/sh\n${delay}${mode === 'exec' ? `exec ${run}` : run}\n`, 'utf8');
  await chmod(shimPath, 0o755);
}

function killProcessGroup(pid: number): void {
  for (const target of [-pid, pid]) {
    try {
      process.kill(target, 'SIGKILL');
    } catch {
      // Gone already, or not a group leader.
    }
  }
}

async function readCapture(capturePath: string): Promise<CaptureEntry[]> {
  const entries = (await readFile(capturePath, 'utf8'))
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as CaptureEntry);
  for (const entry of entries) {
    if (entry.kind === 'spawn') {
      fakePids.add(entry.pid);
    }
  }
  return entries;
}

async function waitUntil(condition: () => boolean | Promise<boolean>, timeoutMs: number): Promise<boolean> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await condition()) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return condition();
}

type TurnResult = {
  messages: NormalizedMessage[];
  capture: CaptureEntry[];
  error: Error | null;
  requests(method: string, pathname: string): CaptureEntry[];
};

/**
 * Runs one chat turn through `opencodeRuntime.run` against the fake server.
 * `onMessage` sees every frame the runtime sends, so a test can answer a
 * prompt the way the chat client would.
 */
async function runTurn(input: {
  scenario: AnyRecord;
  appSessionId: string;
  prompt?: string;
  options?: AnyRecord;
  onMessage?: (message: NormalizedMessage) => void;
  /** Runs next to the turn, with the capture file the fake writes to. */
  whileRunning?: (capturePath: string) => Promise<void>;
  /** Called the moment the runtime's promise settles. */
  onSettled?: () => void;
}): Promise<TurnResult> {
  runCounter += 1;
  const scenarioPath = path.join(tempRoot, `scenario-${runCounter}.json`);
  const capturePath = path.join(tempRoot, `capture-${runCounter}.jsonl`);
  await writeFile(scenarioPath, JSON.stringify(input.scenario), 'utf8');
  await writeFile(capturePath, '', 'utf8');
  setEnv('FAKE_OPENCODE_SCENARIO', scenarioPath);
  setEnv('FAKE_OPENCODE_CAPTURE', capturePath);

  const messages: NormalizedMessage[] = [];
  const writer = {
    userId: null,
    send(message: unknown) {
      messages.push(message as NormalizedMessage);
      input.onMessage?.(message as NormalizedMessage);
    },
    setSessionId(sessionId: string) {
      providerSessionIds.set(input.appSessionId, sessionId);
    },
  };

  let error: Error | null = null;
  let deadline: NodeJS.Timeout | undefined;
  try {
    const turn = opencodeRuntime.run(
      input.prompt ?? 'Run it',
      { cwd: projectDir, sessionId: input.appSessionId, model: 'fake/fake-model', ...input.options },
      writer,
      runtimeContext,
    );
    turn.then(() => input.onSettled?.(), () => input.onSettled?.());
    const stuck = new Promise<'stuck'>((resolve) => {
      deadline = setTimeout(() => resolve('stuck'), TURN_DEADLINE_MS);
    });
    const sideTask = input.whileRunning?.(capturePath);
    if (await Promise.race([turn, stuck]) === 'stuck') {
      await opencodeRuntime.abort(input.appSessionId);
      await turn.catch(() => undefined);
      throw new Error(`the turn did not finish within ${TURN_DEADLINE_MS / 1000} s`);
    }
    await sideTask;
  } catch (caught) {
    error = caught as Error;
  } finally {
    clearTimeout(deadline);
  }

  const capture = await readCapture(capturePath);
  return {
    messages,
    capture,
    error,
    requests: (method, pathname) =>
      capture.filter((entry) => entry.kind === 'request' && entry.method === method && entry.path === pathname),
  };
}

const kinds = (messages: NormalizedMessage[]) => messages.map((message) => message.kind);

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
  } catch {
    return false;
  }
  if (process.platform !== 'linux') {
    return true;
  }
  // kill() also reaches a process that exited but was not reaped yet, which
  // an orphan never is under a container's PID 1 without an init.
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
    return stat.slice(stat.lastIndexOf(')') + 2).split(' ')[0] !== 'Z';
  } catch {
    return false;
  }
}

// --- scripted OpenCode events ("$SID" is the session the turn runs in) ---

const permissionAsked = (id: string, command: string, extra: AnyRecord = {}) => ({
  emit: {
    type: 'permission.asked',
    properties: {
      id,
      sessionID: '$SID',
      permission: 'bash',
      patterns: [command],
      metadata: { command },
      always: [`${command.split(' ')[0]} *`],
      tool: { messageID: 'msg_assistant', callID: `call_${id}` },
      ...extra,
    },
  },
});

const toolPart = (callID: string, status: 'completed' | 'error', text: string, tool = 'bash') => ({
  emit: {
    type: 'message.part.updated',
    properties: {
      part: {
        id: `prt_${callID}`,
        messageID: 'msg_assistant',
        sessionID: '$SID',
        type: 'tool',
        tool,
        callID,
        state: status === 'completed'
          ? { status, input: {}, output: text, title: '', metadata: {}, time: { start: 1, end: 2 } }
          : { status, input: {}, error: text, time: { start: 1, end: 2 } },
      },
    },
  },
});

const textPart = (text: string, ended = true) => ({
  emit: {
    type: 'message.part.updated',
    properties: {
      part: {
        id: `prt_text_${ended ? 'end' : 'start'}`,
        messageID: 'msg_reply',
        sessionID: '$SID',
        type: 'text',
        text,
        time: ended ? { start: 1, end: 2 } : { start: 1 },
      },
    },
  },
});

const stepFinish = () => ({
  emit: {
    type: 'message.part.updated',
    properties: {
      part: { id: 'prt_finish', messageID: 'msg_reply', sessionID: '$SID', type: 'step-finish', reason: 'stop' },
    },
  },
});

// A bash call that waits for the user: runs on once/always, stops on reject.
const bashCallSteps = (id: string, command: string) => [
  permissionAsked(id, command),
  { await: id },
  {
    branch: id,
    cases: {
      reject: [toolPart(`call_${id}`, 'error', 'The user rejected permission to use this specific tool call.'), { stop: true }],
    },
  },
  toolPart(`call_${id}`, 'completed', `ran ${command}`),
];

const PLAN_SWITCH_RULES = [
  { permission: 'plan_enter', pattern: '*', action: 'deny' },
  { permission: 'plan_exit', pattern: '*', action: 'deny' },
];
const QUESTION_DENY = { permission: 'question', pattern: '*', action: 'deny' };
const QUESTION_ALLOW = { permission: 'question', pattern: '*', action: 'allow' };

const sessionStatus = (type: 'busy' | 'idle') => ({
  emit: { type: 'session.status', properties: { sessionID: '$SID', status: { type } } },
});

const twoQuestions = [
  {
    question: 'Which color should the button be?',
    header: 'Color',
    options: [{ label: 'Red', description: 'Warm' }, { label: 'Blue', description: 'Calm' }],
  },
  {
    question: 'Which sizes should ship?',
    header: 'Sizes',
    multiple: true,
    custom: false,
    options: [{ label: 'Small' }, { label: 'Large, wide', description: 'label with a comma' }],
  },
];

const questionSteps = (id: string) => [
  { emit: { type: 'question.asked', properties: { id, sessionID: '$SID', questions: twoQuestions, tool: { messageID: 'msg_assistant', callID: `call_${id}` } } } },
  { await: id },
  {
    branch: id,
    cases: {
      answered: [toolPart(`call_${id}`, 'completed', 'User has answered your questions', 'question')],
      rejected: [toolPart(`call_${id}`, 'error', 'The user dismissed this question', 'question'), { stop: true }],
    },
  },
];

test('opencode advertises interactive permission requests', () => {
  assert.equal(providerCapabilitiesService.getProviderCapabilities('opencode').supportsPermissionRequests, true);
});

test('a permission request reaches the chat and "Allow once" lets the tool run', async () => {
  let promptSeen: NormalizedMessage | null = null;
  const turn = await runTurn({
    appSessionId: 'app-once',
    scenario: { newSessionId: 'ses_once', steps: [...bashCallSteps('per_once', 'printf hi'), stepFinish(), textPart('done')] },
    onMessage(message) {
      if (message.kind === 'permission_request') {
        promptSeen = message;
        opencodeRuntime.permissions.resolve(message.requestId as string, { allow: true });
      }
    },
  });

  assert.equal(turn.error, null);
  const prompt = promptSeen as NormalizedMessage | null;
  assert.ok(prompt, 'the permission request reached the chat');
  assert.equal(prompt.provider, 'opencode');
  assert.equal(prompt.toolName, 'bash');
  assert.equal(prompt.requestId, 'per_once');
  assert.deepEqual(prompt.input, { command: 'printf hi', patterns: ['printf hi'] });
  assert.deepEqual((prompt.context as AnyRecord).always, ['printf *']);

  // session_created first, the prompt and its retraction, then the tool result.
  assert.deepEqual(kinds(turn.messages), [
    'session_created',
    'permission_request',
    'permission_resolved',
    'tool_use',
    'stream_end',
    'text',
    'complete',
  ]);
  const toolUse = turn.messages.find((message) => message.kind === 'tool_use');
  assert.equal(toolUse?.toolName, 'bash');
  assert.equal(toolUse?.toolResult?.isError, false);
  const complete = turn.messages.filter((message) => message.kind === 'complete');
  assert.equal(complete.length, 1);
  assert.equal(complete[0].exitCode, 0);

  assert.deepEqual(turn.requests('POST', '/permission/per_once/reply').map((entry) => entry.body), [{ reply: 'once' }]);
  // New sessions keep run's plan-switch rules but no longer hide the question tool.
  assert.deepEqual(turn.requests('POST', '/session')[0].body, {
    permission: [
      { permission: 'plan_enter', pattern: '*', action: 'deny' },
      { permission: 'plan_exit', pattern: '*', action: 'deny' },
    ],
  });
  const prompted = turn.requests('POST', '/session/ses_once/message')[0].body as AnyRecord;
  assert.deepEqual(prompted.parts, [{ type: 'text', text: 'Run it' }]);
  assert.deepEqual(prompted.model, { providerID: 'fake', modelID: 'fake-model' });
  assert.equal(prompted.agent, undefined);

  // A private, authenticated, loopback-only server for this directory, gone afterwards.
  const spawn = turn.capture.find((entry) => entry.kind === 'spawn');
  assert.deepEqual(spawn?.argv?.slice(0, 4), ['serve', '--hostname', '127.0.0.1', '--port']);
  assert.notEqual(spawn?.argv?.[4], '4096');
  assert.equal(spawn?.hasPassword, true);
  assert.ok(turn.capture.filter((entry) => entry.kind === 'request').every((entry) => entry.authorized));
  assert.ok(turn.capture.filter((entry) => entry.kind === 'request').every((entry) => entry.directory === projectDir));
  assert.ok(turn.capture.some((entry) => entry.kind === 'exit' && entry.signal === 'SIGTERM'));
  assert.equal(isProcessAlive(spawn?.pid as number), false);
  assert.deepEqual(opencodeRuntime.permissions.listPending('app-once'), []);
});

test('"Always allow" replies always and later turns of the same chat are not asked again', async () => {
  const first = await runTurn({
    appSessionId: 'app-always',
    scenario: { newSessionId: 'ses_always', steps: bashCallSteps('per_a1', 'printf one') },
    onMessage(message) {
      if (message.kind === 'permission_request') {
        opencodeRuntime.permissions.resolve(message.requestId as string, { allow: true, rememberEntry: 'printf *' });
      }
    },
  });
  assert.equal(first.error, null);
  assert.deepEqual(first.requests('POST', '/permission/per_a1/reply').map((entry) => entry.body), [{ reply: 'always' }]);

  // Next turn of the same chat: a request matching the approved pattern is
  // answered without a prompt (the per-turn server forgot the approval).
  const second = await runTurn({
    appSessionId: 'app-always',
    scenario: { sessions: { ses_always: { permission: [] } }, steps: bashCallSteps('per_a2', 'printf two') },
  });
  assert.equal(second.error, null);
  assert.equal(kinds(second.messages).includes('permission_request'), false);
  assert.equal(kinds(second.messages).includes('session_created'), false);
  assert.deepEqual(second.requests('POST', '/permission/per_a2/reply').map((entry) => entry.body), [{ reply: 'once' }]);

  // Another chat is still asked.
  const other = await runTurn({
    appSessionId: 'app-always-other',
    scenario: { newSessionId: 'ses_other', steps: bashCallSteps('per_a3', 'printf two') },
    onMessage(message) {
      if (message.kind === 'permission_request') {
        opencodeRuntime.permissions.resolve(message.requestId as string, { allow: true });
      }
    },
  });
  assert.equal(other.error, null);
  assert.equal(kinds(other.messages).includes('permission_request'), true);
});

test('Deny sends a plain reject, so the turn stops like OpenCode\'s own Reject', async () => {
  const turn = await runTurn({
    appSessionId: 'app-deny',
    scenario: { newSessionId: 'ses_deny', steps: [...bashCallSteps('per_deny', 'rm -rf build'), textPart('never reached')] },
    onMessage(message) {
      if (message.kind === 'permission_request') {
        opencodeRuntime.permissions.resolve(message.requestId as string, { allow: false, message: 'User denied tool use' });
      }
    },
  });

  assert.equal(turn.error, null);
  assert.deepEqual(turn.requests('POST', '/permission/per_deny/reply').map((entry) => entry.body), [{ reply: 'reject' }]);
  const toolUse = turn.messages.find((message) => message.kind === 'tool_use');
  assert.equal(toolUse?.toolResult?.isError, true);
  assert.equal(turn.messages.some((message) => message.kind === 'text'), false);
  assert.equal(turn.messages.filter((message) => message.kind === 'complete').length, 1);
});

test('an agent question reaches the chat and its answers go back as label lists', async () => {
  let questionPrompt: NormalizedMessage | null = null;
  const turn = await runTurn({
    appSessionId: 'app-question',
    scenario: { newSessionId: 'ses_question', steps: questionSteps('que_1') },
    onMessage(message) {
      if (message.kind === 'permission_request') {
        questionPrompt = message;
        opencodeRuntime.permissions.resolve(message.requestId as string, {
          allow: true,
          updatedInput: { answers: [['Red'], ['Small', 'Large, wide', 'a custom size']] },
        });
      }
    },
  });

  assert.equal(turn.error, null);
  const prompt = questionPrompt as NormalizedMessage | null;
  assert.ok(prompt, 'the question reached the chat');
  assert.equal(prompt.toolName, 'question');
  assert.deepEqual(prompt.input, {
    questions: [
      {
        question: 'Which color should the button be?',
        header: 'Color',
        options: [{ label: 'Red', description: 'Warm' }, { label: 'Blue', description: 'Calm' }],
        multiSelect: false,
        custom: true,
      },
      {
        question: 'Which sizes should ship?',
        header: 'Sizes',
        options: [{ label: 'Small', description: undefined }, { label: 'Large, wide', description: 'label with a comma' }],
        multiSelect: true,
        custom: false,
      },
    ],
  });
  assert.equal((prompt.context as AnyRecord).answerFormat, 'label-lists');
  assert.deepEqual(turn.requests('POST', '/question/que_1/reply').map((entry) => entry.body), [
    { answers: [['Red'], ['Small', 'Large, wide', 'a custom size']] },
  ]);
  assert.equal(turn.messages.find((message) => message.kind === 'tool_use')?.toolResult?.isError, false);
});

test('dismissing an agent question rejects it', async () => {
  const turn = await runTurn({
    appSessionId: 'app-question-skip',
    scenario: { newSessionId: 'ses_question_skip', steps: questionSteps('que_2') },
    onMessage(message) {
      if (message.kind === 'permission_request') {
        opencodeRuntime.permissions.resolve(message.requestId as string, { allow: false });
      }
    },
  });

  assert.equal(turn.error, null);
  assert.equal(turn.requests('POST', '/question/que_2/reject').length, 1);
  assert.equal(turn.requests('POST', '/question/que_2/reply').length, 0);
  assert.equal(turn.messages.find((message) => message.kind === 'tool_use')?.toolResult?.isError, true);
});

test('aborting while a prompt waits withdraws it, aborts the session and stops the server', async () => {
  let abortResult: Promise<boolean> | null = null;
  let pendingWhileWaiting: unknown[] = [];
  const turn = await runTurn({
    appSessionId: 'app-abort',
    scenario: { newSessionId: 'ses_abort', steps: bashCallSteps('per_abort', 'sleep 30') },
    onMessage(message) {
      if (message.kind === 'permission_request') {
        pendingWhileWaiting = opencodeRuntime.permissions.listPending('app-abort');
        abortResult = Promise.resolve(opencodeRuntime.abort('app-abort'));
      }
    },
  });

  assert.equal(turn.error, null, 'an aborted turn resolves');
  assert.equal(await abortResult, true);
  assert.equal(pendingWhileWaiting.length, 1);
  assert.deepEqual(opencodeRuntime.permissions.listPending('app-abort'), []);
  const cancelled = turn.messages.find((message) => message.kind === 'permission_cancelled');
  assert.equal(cancelled?.requestId, 'per_abort');
  assert.equal(cancelled?.reason, 'cancelled');
  assert.equal(turn.requests('POST', '/session/ses_abort/abort').length, 1);
  assert.equal(turn.requests('POST', '/permission/per_abort/reply').length, 0);
  // The abort handler sends the terminal complete; the runtime must not, and
  // OpenCode's MessageAbortedError is not shown as an error.
  assert.equal(turn.messages.some((message) => message.kind === 'complete'), false);
  assert.equal(turn.messages.some((message) => message.kind === 'error'), false);
  const spawn = turn.capture.find((entry) => entry.kind === 'spawn');
  assert.equal(isProcessAlive(spawn?.pid as number), false);
});

test('a stopped turn settles only once its stop has finished', async () => {
  // chat.abort sends the stopped turn's terminal complete when the runtime's
  // abort returns; if the turn settled first, the chat's safety net would
  // report it as failed (exit code 1, not aborted). Here OpenCode takes the
  // abort but its event stream ends before any idle, so the turn ends while
  // the abort still waits for the server to go.
  const order: string[] = [];
  let abortDone: Promise<unknown> = Promise.resolve();
  const turn = await runTurn({
    appSessionId: 'app-abort-order',
    scenario: { newSessionId: 'ses_abort_order', abortDropsEvents: true, steps: bashCallSteps('per_order', 'sleep 30') },
    onMessage(message) {
      if (message.kind === 'permission_request') {
        abortDone = Promise.resolve(opencodeRuntime.abort('app-abort-order')).then(() => order.push('abort returned'));
      }
    },
    onSettled: () => order.push('turn settled'),
  });
  await abortDone;

  assert.equal(turn.error, null);
  assert.deepEqual(order, ['abort returned', 'turn settled']);
  assert.equal(turn.messages.some((message) => message.kind === 'complete'), false);
});

test('bypassPermissions answers requests like `opencode run --auto` and never prompts', async () => {
  const turn = await runTurn({
    appSessionId: 'app-bypass',
    options: { permissionMode: 'bypassPermissions' },
    scenario: {
      newSessionId: 'ses_bypass',
      steps: [...bashCallSteps('per_bypass', 'printf auto'), ...questionSteps('que_bypass')],
    },
  });

  assert.equal(turn.messages.some((message) => message.kind === 'permission_request'), false);
  assert.deepEqual(turn.requests('POST', '/permission/per_bypass/reply').map((entry) => entry.body), [{ reply: 'once' }]);
  // Bypass sessions hide the question tool; should a question still come,
  // it is left unanswered so the model carries on (a reject ends the turn).
  assert.equal(turn.requests('POST', '/question/que_bypass/reject').length, 0);
  assert.deepEqual(turn.requests('POST', '/question/que_bypass/reply').map((entry) => entry.body), [{ answers: [[], []] }]);
  assert.deepEqual(turn.requests('POST', '/session')[0].body, {
    permission: [
      { permission: 'question', pattern: '*', action: 'deny' },
      { permission: 'plan_enter', pattern: '*', action: 'deny' },
      { permission: 'plan_exit', pattern: '*', action: 'deny' },
    ],
  });
});

test('an unanswered prompt of a detached run is replayable, then rejected after the timeout', async () => {
  setEnv('OPENCODE_TOOL_APPROVAL_TIMEOUT_MS', '300');
  let pendingAtPrompt: AnyRecord[] = [];
  try {
    const turn = await runTurn({
      appSessionId: 'app-detached',
      scenario: { newSessionId: 'ses_detached', steps: bashCallSteps('per_detached', 'printf later') },
      onMessage(message) {
        if (message.kind === 'permission_request') {
          pendingAtPrompt = opencodeRuntime.permissions.listPending('app-detached') as AnyRecord[];
        }
      },
    });

    assert.equal(pendingAtPrompt.length, 1);
    assert.equal(pendingAtPrompt[0].requestId, 'per_detached');
    assert.equal(pendingAtPrompt[0].toolName, 'bash');
    assert.deepEqual((pendingAtPrompt[0].context as AnyRecord).always, ['printf *']);
    assert.deepEqual(turn.requests('POST', '/permission/per_detached/reply').map((entry) => entry.body), [{ reply: 'reject' }]);
    const cancelled = turn.messages.find((message) => message.kind === 'permission_cancelled');
    assert.equal(cancelled?.reason, 'timeout');
    assert.equal(turn.messages.filter((message) => message.kind === 'complete').length, 1);
  } finally {
    setEnv('OPENCODE_TOOL_APPROVAL_TIMEOUT_MS', undefined);
  }
});

test('a second answer is ignored and OpenCode\'s cascade retracts the other prompt', async () => {
  const replies: string[] = [];
  const turn = await runTurn({
    appSessionId: 'app-cascade',
    scenario: {
      newSessionId: 'ses_cascade',
      steps: [
        permissionAsked('per_c1', 'printf one'),
        permissionAsked('per_c2', 'printf two'),
        { await: 'per_c1' },
        { settle: 'per_c2', reply: 'always' },
        toolPart('call_per_c1', 'completed', 'one'),
        toolPart('call_per_c2', 'completed', 'two'),
      ],
    },
    onMessage(message) {
      if (message.kind === 'permission_request' && message.requestId === 'per_c2') {
        // Two tabs answer the first prompt.
        opencodeRuntime.permissions.resolve('per_c1', { allow: true, rememberEntry: 'printf *' });
        opencodeRuntime.permissions.resolve('per_c1', { allow: true });
      }
      if (message.kind === 'permission_resolved') {
        replies.push(message.requestId as string);
      }
    },
  });

  assert.equal(turn.error, null);
  assert.deepEqual(turn.requests('POST', '/permission/per_c1/reply').map((entry) => entry.body), [{ reply: 'always' }]);
  assert.equal(turn.requests('POST', '/permission/per_c2/reply').length, 0);
  assert.deepEqual(replies.sort(), ['per_c1', 'per_c2']);
  assert.deepEqual(opencodeRuntime.permissions.listPending('app-cascade'), []);
});

test('bypassPermissions hides the question tool of a resumed session that shows it', async () => {
  // Created by this runtime in default mode: questions are shown.
  providerSessionIds.set('app-bypass-resume', 'ses_default_created');
  const shown = await runTurn({
    appSessionId: 'app-bypass-resume',
    options: { permissionMode: 'bypassPermissions' },
    scenario: { sessions: { ses_default_created: { permission: PLAN_SWITCH_RULES } }, steps: [textPart('decided alone')] },
  });
  assert.equal(shown.error, null);
  assert.deepEqual(shown.requests('PATCH', '/session/ses_default_created').map((entry) => entry.body), [
    { permission: [QUESTION_DENY] },
  ]);
  // Before the prompt reached the model.
  const order = shown.capture.filter((entry) => entry.kind === 'request').map((entry) => `${entry.method} ${entry.path}`);
  assert.ok(order.indexOf('PATCH /session/ses_default_created') < order.indexOf('POST /session/ses_default_created/message'));

  // Already hidden (created in bypassPermissions or by `opencode run`): nothing is appended.
  providerSessionIds.set('app-bypass-resume-hidden', 'ses_bypass_created');
  const hidden = await runTurn({
    appSessionId: 'app-bypass-resume-hidden',
    options: { permissionMode: 'bypassPermissions' },
    scenario: { sessions: { ses_bypass_created: { permission: [QUESTION_DENY, ...PLAN_SWITCH_RULES] } }, steps: [textPart('x')] },
  });
  assert.equal(hidden.error, null);
  assert.equal(hidden.requests('PATCH', '/session/ses_bypass_created').length, 0);

  // The next turn in default mode shows the tool again.
  const back = await runTurn({
    appSessionId: 'app-bypass-resume',
    scenario: {
      sessions: { ses_default_created: { permission: [...PLAN_SWITCH_RULES, QUESTION_DENY] } },
      agents: [{ name: 'build', permission: [QUESTION_ALLOW] }],
      steps: [textPart('asking again')],
    },
  });
  assert.equal(back.error, null);
  assert.deepEqual(back.requests('PATCH', '/session/ses_default_created').map((entry) => entry.body), [
    { permission: [QUESTION_ALLOW] },
  ]);
});

test('"Always allow" covers a later request only when each of its patterns was approved', async () => {
  const first = await runTurn({
    appSessionId: 'app-always-every',
    scenario: { newSessionId: 'ses_every', steps: bashCallSteps('per_e1', 'cd src') },
    onMessage(message) {
      if (message.kind === 'permission_request') {
        opencodeRuntime.permissions.resolve(message.requestId as string, { allow: true, rememberEntry: 'cd *' });
      }
    },
  });
  assert.equal(first.error, null);

  // `cd src && rm -rf build` asks for both commands; only `cd *` was approved.
  const prompted: string[] = [];
  const compound = await runTurn({
    appSessionId: 'app-always-every',
    scenario: {
      sessions: { ses_every: { permission: [] } },
      steps: [
        permissionAsked('per_e2', 'cd src && rm -rf build', { patterns: ['cd src', 'rm -rf build'], always: ['cd *', 'rm *'] }),
        { await: 'per_e2' },
      ],
    },
    onMessage(message) {
      if (message.kind === 'permission_request') {
        prompted.push(message.requestId as string);
        opencodeRuntime.permissions.resolve(message.requestId as string, { allow: false });
      }
    },
  });
  assert.equal(compound.error, null);
  assert.deepEqual(prompted, ['per_e2']);
  assert.deepEqual(compound.requests('POST', '/permission/per_e2/reply').map((entry) => entry.body), [{ reply: 'reject' }]);

  // Every pattern approved: no prompt.
  const covered = await runTurn({
    appSessionId: 'app-always-every',
    scenario: {
      sessions: { ses_every: { permission: [] } },
      steps: [permissionAsked('per_e3', 'cd a && cd b', { patterns: ['cd a', 'cd b'], always: ['cd *'] }), { await: 'per_e3' }],
    },
  });
  assert.equal(covered.error, null);
  assert.equal(kinds(covered.messages).includes('permission_request'), false);
  assert.deepEqual(covered.requests('POST', '/permission/per_e3/reply').map((entry) => entry.body), [{ reply: 'once' }]);
});

test('an answer OpenCode does not take ends the turn with an error instead of leaving it waiting', async () => {
  const turn = await runTurn({
    appSessionId: 'app-reply-refused',
    scenario: { newSessionId: 'ses_reply_refused', replyStatus: 500, steps: bashCallSteps('per_refused', 'printf x') },
    onMessage(message) {
      if (message.kind === 'permission_request') {
        opencodeRuntime.permissions.resolve(message.requestId as string, { allow: true });
      }
    },
  });

  assert.match(String(turn.error?.message), /OpenCode did not accept the answer \(HTTP 500\)/);
  assert.equal(turn.messages.filter((message) => message.kind === 'error').length, 1);
  assert.equal(turn.messages.filter((message) => message.kind === 'complete').length, 1);
  assert.equal(turn.messages.find((message) => message.kind === 'complete')?.exitCode, 1);
  const spawn = turn.capture.find((entry) => entry.kind === 'spawn');
  assert.equal(isProcessAlive(spawn?.pid as number), false);
});

test('a question without questions is answered at once instead of waiting unseen', async () => {
  const turn = await runTurn({
    appSessionId: 'app-empty-question',
    scenario: {
      newSessionId: 'ses_empty_question',
      steps: [
        { emit: { type: 'question.asked', properties: { id: 'que_empty', sessionID: '$SID', questions: [] } } },
        { await: 'que_empty' },
      ],
    },
  });

  assert.equal(turn.error, null);
  assert.equal(kinds(turn.messages).includes('permission_request'), false);
  assert.deepEqual(turn.requests('POST', '/question/que_empty/reply').map((entry) => entry.body), [{ answers: [] }]);
});

test('an idle from before the session went busy again does not cut off what follows the prompt answer', async () => {
  const turn = await runTurn({
    appSessionId: 'app-stale-idle',
    scenario: {
      newSessionId: 'ses_stale_idle',
      // An idle and a busy the runtime has seen well before the prompt answers.
      steps: [sessionStatus('idle'), sessionStatus('busy'), { sleep: 300 }],
      // The prompt answers first; the last part and the idle follow on the stream.
      trailingSteps: [{ sleep: 300 }, textPart('after the answer')],
    },
  });

  assert.equal(turn.error, null);
  assert.equal(turn.messages.find((message) => message.kind === 'text')?.content, 'after the answer');
});

test('a stop during the pause before a second start attempt ends the turn quietly', async () => {
  let turnCapture = '';
  const turn = await runTurn({
    appSessionId: 'app-locked-abort',
    scenario: { lockedOnceMarker: path.join(tempRoot, 'locked-abort.marker'), newSessionId: 'ses_locked_abort', steps: [textPart('x')] },
    async whileRunning(capturePath) {
      turnCapture = capturePath;
      // The first server fails at once like a locked database; stop the turn
      // while the runtime waits to try again.
      let firstPid = 0;
      await waitUntil(async () => {
        firstPid = (await readCapture(capturePath)).find((entry) => entry.kind === 'spawn')?.pid ?? 0;
        return firstPid > 0 && !isProcessAlive(firstPid);
      }, 10_000);
      await new Promise((resolve) => setTimeout(resolve, 150));
      await opencodeRuntime.abort('app-locked-abort');
    },
  });

  // No second server, no fallback to `opencode run`, nothing sent: the stop
  // handler reports the end of the turn.
  assert.equal(turn.error, null);
  await new Promise((resolve) => setTimeout(resolve, 1_500));
  const spawns = (await readCapture(turnCapture)).filter((entry) => entry.kind === 'spawn');
  assert.deepEqual(spawns.map((entry) => entry.argv?.[0]), ['serve']);
  assert.equal(turn.messages.length, 0);
});

test('stopping a server also stops the binary behind a wrapper script', {
  skip: process.platform === 'win32' && 'Windows stops the whole tree with taskkill /T',
}, async () => {
  // Some installs put a shell script in front of the binary, which then runs
  // as the script's child; the server is stopped as a process group.
  const pathKey = findEnvKey('PATH');
  const previousPath = process.env[pathKey];
  process.env[pathKey] = `${wrapperBinDir}${path.delimiter}${previousPath ?? ''}`;
  try {
    const turn = await runTurn({ appSessionId: 'app-wrapper', scenario: { newSessionId: 'ses_wrapper', steps: [textPart('wrapped')] } });

    assert.equal(turn.error, null);
    assert.equal(turn.messages.find((message) => message.kind === 'text')?.content, 'wrapped');
    const spawn = turn.capture.find((entry) => entry.kind === 'spawn');
    assert.equal(spawn?.argv?.[0], 'serve');
    assert.ok(await waitUntil(() => !isProcessAlive(spawn?.pid as number), 5_000), 'the wrapped binary outlived its server');
  } finally {
    process.env[pathKey] = previousPath;
  }
});

test('a wrapped binary that outlives its wrapper script on SIGTERM is killed', {
  skip: process.platform === 'win32' && 'Windows stops the whole tree with taskkill /T /F',
}, async () => {
  // The wrapper script leads the server's process group and exits on SIGTERM;
  // the binary behind it ignores SIGTERM. The stop must not take the leader's
  // exit for the end of the server.
  const pathKey = findEnvKey('PATH');
  const previousPath = process.env[pathKey];
  process.env[pathKey] = `${wrapperBinDir}${path.delimiter}${previousPath ?? ''}`;
  try {
    const turn = await runTurn({
      appSessionId: 'app-wrapper-lingers',
      scenario: { newSessionId: 'ses_wrapper_lingers', ignoreSigterm: true, steps: [textPart('wrapped')] },
    });

    assert.equal(turn.error, null);
    assert.equal(turn.messages.find((message) => message.kind === 'complete')?.exitCode, 0);
    const spawn = turn.capture.find((entry) => entry.kind === 'spawn');
    assert.ok(await waitUntil(() => !isProcessAlive(spawn?.pid as number), 1_000), 'the wrapped binary outlived its stop');
    // SIGTERM first; SIGKILL only once the grace ran out.
    assert.ok(turn.capture.some((entry) => entry.kind === 'sigterm-ignored'), 'the binary was never asked to stop');
  } finally {
    process.env[pathKey] = previousPath;
  }
});

test('a stop does not wait for processes of its group that exited but nobody reaps', {
  skip: !CAN_EXEC_AS_SUBREAPER && 'needs Linux and python3 to run CloudCLI as a subreaper that reaps nothing',
}, async () => {
  // CloudCLI as a container's PID 1 without an init: the binary behind a
  // wrapper script outlives the script on SIGTERM, is reparented to CloudCLI,
  // and once it exits stays a zombie in the server's process group.
  runCounter += 1;
  const scenarioPath = path.join(tempRoot, `scenario-${runCounter}.json`);
  const capturePath = path.join(tempRoot, `capture-${runCounter}.jsonl`);
  await writeFile(scenarioPath, JSON.stringify({}), 'utf8');
  await writeFile(capturePath, '', 'utf8');
  const script = path.join(tempRoot, 'cloudcli-reaps-nothing.mts');
  await writeFile(script, [
    `import { readFileSync } from 'node:fs';`,
    `import { OpenCodeServerProcess } from ${JSON.stringify(pathToFileURL(SERVER_PROCESS_MODULE).href)};`,
    `const server = await OpenCodeServerProcess.start({ cwd: ${JSON.stringify(projectDir)}, env: process.env });`,
    'const startedAt = Date.now();',
    'await server.stop();',
    'const stopMs = Date.now() - startedAt;',
    `const capture = readFileSync(${JSON.stringify(capturePath)}, 'utf8').split('\\n').filter(Boolean).map((line) => JSON.parse(line));`,
    "const binary = capture.find((entry) => entry.kind === 'spawn');",
    "let binaryState = 'reaped';",
    'try {',
    "  const stat = readFileSync(`/proc/${binary.pid}/stat`, 'utf8');",
    "  binaryState = stat.slice(stat.lastIndexOf(')') + 2).split(' ')[0];",
    '} catch {}',
    'console.log(JSON.stringify({ stopMs, binaryState }));',
    'process.exit(0);',
    '',
  ].join('\n'), 'utf8');

  const pathKey = findEnvKey('PATH');
  const cloudcli = spawn('python3', ['-c', EXEC_AS_SUBREAPER_PY, process.execPath, '--import', TSX_LOADER, script], {
    cwd: APPLICATION_ROOT,
    env: {
      ...process.env,
      [pathKey]: `${wrapperBinDir}${path.delimiter}${process.env[pathKey] ?? ''}`,
      FAKE_OPENCODE_SCENARIO: scenarioPath,
      FAKE_OPENCODE_CAPTURE: capturePath,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  cloudcli.stdout.on('data', (chunk: Buffer) => {
    output += chunk.toString();
  });
  cloudcli.stderr.on('data', (chunk: Buffer) => {
    output += chunk.toString();
  });
  const exited = new Promise<number | null>((resolve) => cloudcli.once('exit', resolve));
  let guard: NodeJS.Timeout | undefined;
  try {
    const exitCode = await Promise.race([
      exited,
      new Promise<'stuck'>((resolve) => {
        guard = setTimeout(() => resolve('stuck'), 30_000);
      }),
    ]);
    assert.equal(exitCode, 0, output);
    const result = JSON.parse(output.trim().split('\n').pop() ?? '{}') as { stopMs: number; binaryState: string };
    // The case under test happened: the binary was asked to stop, exited and
    // was left unreaped.
    assert.ok((await readCapture(capturePath)).some((entry) => entry.kind === 'exit' && entry.signal === 'SIGTERM'));
    assert.equal(result.binaryState, 'Z', output);
    assert.ok(result.stopMs < 3_000, `the stop waited ${result.stopMs} ms for a process that had exited`);
  } finally {
    clearTimeout(guard);
    cloudcli.kill('SIGKILL');
  }
});

test('a server still starting when CloudCLI exits is stopped too', {
  skip: process.platform === 'win32' && 'POSIX signals',
}, async () => {
  runCounter += 1;
  const scenarioPath = path.join(tempRoot, `scenario-${runCounter}.json`);
  const capturePath = path.join(tempRoot, `capture-${runCounter}.jsonl`);
  // Boots for a minute, far longer than the test: it must be stopped while booting.
  await writeFile(scenarioPath, JSON.stringify({ listenDelayMs: 60_000 }), 'utf8');
  await writeFile(capturePath, '', 'utf8');
  const script = path.join(tempRoot, 'cloudcli-exits-during-start.mts');
  await writeFile(script, [
    `import { OpenCodeServerProcess } from ${JSON.stringify(pathToFileURL(SERVER_PROCESS_MODULE).href)};`,
    // CloudCLI's own shutdown: SIGTERM ends in process.exit().
    `process.on('SIGTERM', () => process.exit(0));`,
    `OpenCodeServerProcess.start({ cwd: ${JSON.stringify(projectDir)}, env: process.env }).catch(() => {});`,
    'setInterval(() => {}, 1000);',
    '',
  ].join('\n'), 'utf8');

  const pathKey = findEnvKey('PATH');
  const cloudcli = spawn(process.execPath, ['--import', TSX_LOADER, script], {
    cwd: APPLICATION_ROOT,
    env: {
      ...process.env,
      // Behind a wrapper script, so only a signal to the server's whole
      // process group reaches the binary (the script alone would leave it).
      [pathKey]: `${wrapperBinDir}${path.delimiter}${process.env[pathKey] ?? ''}`,
      FAKE_OPENCODE_SCENARIO: scenarioPath,
      FAKE_OPENCODE_CAPTURE: capturePath,
    },
    stdio: 'ignore',
  });
  const cloudcliExited = new Promise((resolve) => cloudcli.once('exit', resolve));
  try {
    // The fake records its spawn as soon as it runs, long before it listens.
    let serverPid = 0;
    const started = await waitUntil(async () => {
      serverPid = (await readCapture(capturePath)).find((entry) => entry.kind === 'spawn')?.pid ?? 0;
      return serverPid > 0;
    }, 15_000);
    assert.ok(started, 'the server never started');

    cloudcli.kill('SIGTERM');
    await cloudcliExited;
    assert.ok(await waitUntil(() => !isProcessAlive(serverPid), 5_000), 'the booting server outlived CloudCLI');
    assert.ok((await readCapture(capturePath)).some((entry) => entry.kind === 'exit' && entry.signal === 'SIGTERM'));
  } finally {
    cloudcli.kill('SIGKILL');
  }
});

test('requests from a subagent session are asked, unrelated sessions are ignored', async () => {
  const requested: string[] = [];
  const turn = await runTurn({
    appSessionId: 'app-subagent',
    scenario: {
      newSessionId: 'ses_parent',
      steps: [
        { emit: { type: 'permission.asked', properties: { id: 'per_foreign', sessionID: 'ses_someone_else', permission: 'bash', patterns: ['x'], metadata: {}, always: [] } } },
        { emit: { type: 'session.created', properties: { sessionID: 'ses_child', info: { id: 'ses_child', parentID: '$SID' } } } },
        { emit: { type: 'permission.asked', properties: { id: 'per_child', sessionID: 'ses_child', permission: 'bash', patterns: ['ls'], metadata: { command: 'ls' }, always: ['ls *'] } } },
        { await: 'per_child' },
      ],
    },
    onMessage(message) {
      if (message.kind === 'permission_request') {
        requested.push(message.requestId as string);
        opencodeRuntime.permissions.resolve(message.requestId as string, { allow: true });
      }
    },
  });

  assert.equal(turn.error, null);
  assert.deepEqual(requested, ['per_child']);
  assert.equal(turn.requests('POST', '/permission/per_foreign/reply').length, 0);
});

test('resuming a session `opencode run` created brings the question tool back unless the user denies it', async () => {
  const runCreatedRules = [
    { permission: 'question', pattern: '*', action: 'deny' },
    { permission: 'plan_enter', pattern: '*', action: 'deny' },
    { permission: 'plan_exit', pattern: '*', action: 'deny' },
  ];
  providerSessionIds.set('app-resume', 'ses_run_created');
  const allowed = await runTurn({
    appSessionId: 'app-resume',
    scenario: {
      sessions: { ses_run_created: { permission: runCreatedRules } },
      agents: [{ name: 'build', permission: [{ permission: '*', pattern: '*', action: 'allow' }, { permission: 'question', pattern: '*', action: 'allow' }] }],
      steps: [textPart('resumed')],
    },
  });
  assert.equal(allowed.error, null);
  assert.equal(kinds(allowed.messages).includes('session_created'), false);
  assert.deepEqual(allowed.requests('PATCH', '/session/ses_run_created').map((entry) => entry.body), [
    { permission: [{ permission: 'question', pattern: '*', action: 'allow' }] },
  ]);
  assert.equal(allowed.requests('POST', '/session/ses_run_created/message').length, 1);

  providerSessionIds.set('app-resume-denied', 'ses_run_denied');
  const denied = await runTurn({
    appSessionId: 'app-resume-denied',
    scenario: {
      sessions: { ses_run_denied: { permission: runCreatedRules } },
      // The user's own config hides questions: keep it that way.
      agents: [{ name: 'build', permission: [{ permission: 'question', pattern: '*', action: 'allow' }, { permission: 'question', pattern: '*', action: 'deny' }] }],
      steps: [textPart('resumed')],
    },
  });
  assert.equal(denied.error, null);
  assert.equal(denied.requests('PATCH', '/session/ses_run_denied').length, 0);

  providerSessionIds.set('app-resume-missing', 'ses_missing');
  const missing = await runTurn({ appSessionId: 'app-resume-missing', scenario: { sessions: {} } });
  assert.match(String(missing.error?.message), /Session not found/);
  assert.equal(missing.messages.find((message) => message.kind === 'error')?.content, 'Session not found');
  assert.equal(missing.messages.find((message) => message.kind === 'complete')?.exitCode, 1);
});

test('plan mode prompts the plan agent and acceptEdits allows edits through OPENCODE_PERMISSION', async () => {
  const plan = await runTurn({
    appSessionId: 'app-plan',
    options: { permissionMode: 'plan' },
    scenario: { newSessionId: 'ses_plan', steps: [textPart('planned')] },
  });
  assert.equal((plan.requests('POST', '/session/ses_plan/message')[0].body as AnyRecord).agent, 'plan');
  assert.equal(plan.capture.find((entry) => entry.kind === 'spawn')?.permissionEnv, null);

  const acceptEdits = await runTurn({
    appSessionId: 'app-accept-edits',
    options: { permissionMode: 'acceptEdits' },
    scenario: { newSessionId: 'ses_accept', steps: [textPart('edited')] },
  });
  assert.equal(acceptEdits.capture.find((entry) => entry.kind === 'spawn')?.permissionEnv, '{"edit":"allow"}');
  assert.equal((acceptEdits.requests('POST', '/session/ses_accept/message')[0].body as AnyRecord).agent, undefined);
});

test('a failed prompt reports OpenCode\'s own error once and fails the turn', async () => {
  const turn = await runTurn({
    appSessionId: 'app-prompt-error',
    scenario: {
      newSessionId: 'ses_prompt_error',
      promptStatus: 500,
      promptBody: { name: 'UnknownError', data: { message: 'Unexpected server error.' } },
      steps: [{ emit: { type: 'session.error', properties: { sessionID: '$SID', error: { name: 'ProviderModelNotFoundError', data: { message: 'Model not found: fake/nope' } } } } }],
    },
  });

  assert.match(String(turn.error?.message), /Model not found/);
  assert.deepEqual(
    turn.messages.filter((message) => message.kind === 'error').map((message) => message.content),
    ['Model not found: fake/nope'],
  );
  assert.equal(turn.messages.find((message) => message.kind === 'complete')?.exitCode, 1);
});

test('a server that dies mid-turn fails the turn and withdraws its prompt', async () => {
  const turn = await runTurn({
    appSessionId: 'app-crash',
    scenario: { newSessionId: 'ses_crash', steps: [permissionAsked('per_crash', 'printf x'), { sleep: 100 }, { exit: 3 }] },
  });

  assert.match(String(turn.error?.message), /OpenCode server exited unexpectedly/);
  assert.equal(turn.messages.find((message) => message.kind === 'permission_cancelled')?.requestId, 'per_crash');
  assert.equal(turn.messages.filter((message) => message.kind === 'complete').length, 1);
  assert.equal(turn.messages.find((message) => message.kind === 'complete')?.exitCode, 1);
  assert.deepEqual(opencodeRuntime.permissions.listPending('app-crash'), []);
});

test('losing the event stream mid-turn aborts the session and fails the turn', async () => {
  const turn = await runTurn({
    appSessionId: 'app-stream-lost',
    scenario: { newSessionId: 'ses_stream_lost', steps: [permissionAsked('per_lost', 'printf x'), { closeEvents: true }, { await: 'per_lost' }] },
  });

  assert.match(String(turn.error?.message), /Lost the event stream/);
  assert.equal(turn.requests('POST', '/session/ses_stream_lost/abort').length, 1);
  assert.equal(turn.messages.find((message) => message.kind === 'permission_cancelled')?.requestId, 'per_lost');
  assert.equal(turn.messages.find((message) => message.kind === 'complete')?.exitCode, 1);
  const spawn = turn.capture.find((entry) => entry.kind === 'spawn');
  assert.equal(isProcessAlive(spawn?.pid as number), false);
});

test('a server that hits a locked opencode database at start is started once more', async () => {
  const turn = await runTurn({
    appSessionId: 'app-locked-db',
    scenario: {
      lockedOnceMarker: path.join(tempRoot, 'locked-once.marker'),
      newSessionId: 'ses_locked',
      steps: [textPart('started on the second try')],
    },
  });

  assert.equal(turn.error, null);
  assert.deepEqual(turn.capture.filter((entry) => entry.kind === 'spawn').map((entry) => entry.argv?.[0]), ['serve', 'serve']);
  assert.equal(turn.messages.find((message) => message.kind === 'text')?.content, 'started on the second try');
});

test('falls back to `opencode run` when the server cannot start or lacks the permission API', async () => {
  for (const serve of ['exit', 'no-api']) {
    const turn = await runTurn({ appSessionId: `app-fallback-${serve}`, scenario: { serve } });

    assert.equal(turn.error, null, serve);
    const spawns = turn.capture.filter((entry) => entry.kind === 'spawn').map((entry) => entry.argv?.[0]);
    assert.deepEqual(spawns, ['serve', 'run'], serve);
    const runArgs = turn.capture.filter((entry) => entry.kind === 'spawn')[1].argv as string[];
    assert.deepEqual(runArgs.slice(0, 5), ['run', '--format', 'json', '--dir', projectDir], serve);
    assert.equal(turn.messages.find((message) => message.kind === 'text')?.content, 'from opencode run', serve);
    assert.equal(turn.messages.filter((message) => message.kind === 'complete').length, 1, serve);
    // Nothing reached the model through the server before falling back.
    assert.equal(turn.capture.some((entry) => entry.kind === 'request' && entry.path?.endsWith('/message')), false, serve);
    const serverPid = turn.capture.find((entry) => entry.kind === 'spawn')?.pid as number;
    assert.equal(isProcessAlive(serverPid), false, serve);
  }
});
