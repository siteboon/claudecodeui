import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test, { after, before } from 'node:test';
import { fileURLToPath } from 'node:url';

import { opencodeRuntime } from '@/modules/providers/list/opencode/opencode-runtime.provider.js';
import { OpenCodeSessionsProvider } from '@/modules/providers/list/opencode/opencode-sessions.provider.js';
import { providerCapabilitiesService } from '@/modules/providers/services/provider-capabilities.service.js';
import type { AnyRecord, NormalizedMessage } from '@/shared/types.js';

/**
 * OpenCode chat turns run on a private `opencode serve` so OpenCode's
 * permission requests and the agent's questions reach the chat user (#1569).
 * Before, every turn ran `opencode run`, which rejected each request itself and
 * hid the question tool. These tests drive the real runtime adapter against a
 * fake `opencode` executable (fixtures/fake-opencode-serve.cjs) that emulates
 * the server's HTTP API and event stream and records every request it gets.
 */

const FIXTURES_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const FAKE_OPENCODE = path.join(FIXTURES_DIR, 'fake-opencode-serve.cjs');

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
let runCounter = 0;
const savedEnv = new Map<string, string | undefined>();

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
  const binDir = path.join(tempRoot, 'bin');
  const homeDir = path.join(tempRoot, 'home');
  await mkdir(projectDir, { recursive: true });
  await mkdir(binDir, { recursive: true });
  await mkdir(homeDir, { recursive: true });

  if (process.platform === 'win32') {
    await writeFile(path.join(binDir, 'opencode.cmd'), `@echo off\r\nnode "${FAKE_OPENCODE}" %*\r\n`, 'utf8');
    const pathExtKey = findEnvKey('PATHEXT');
    const pathExt = process.env[pathExtKey];
    setEnv(pathExtKey, pathExt?.toUpperCase().includes('.CMD') ? pathExt : `.COM;.EXE;.BAT;.CMD${pathExt ? `;${pathExt}` : ''}`);
  } else {
    const shimPath = path.join(binDir, 'opencode');
    await writeFile(shimPath, `#!/bin/sh\nexec node "${FAKE_OPENCODE}" "$@"\n`, 'utf8');
    await chmod(shimPath, 0o755);
  }

  const pathKey = findEnvKey('PATH');
  setEnv(pathKey, `${binDir}${path.delimiter}${process.env[pathKey] || ''}`);
  // Token usage is read from ~/.local/share/opencode; keep it (and any app DB)
  // away from the real home directory.
  setEnv('HOME', homeDir);
  setEnv('USERPROFILE', homeDir);
  setEnv('DATABASE_PATH', path.join(tempRoot, 'auth.db'));
  setEnv('OPENCODE_PERMISSION', undefined);
});

after(async () => {
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
  kind: 'spawn' | 'request' | 'exit' | 'crash';
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
  try {
    await opencodeRuntime.run(
      input.prompt ?? 'Run it',
      { cwd: projectDir, sessionId: input.appSessionId, model: 'fake/fake-model', ...input.options },
      writer,
      runtimeContext,
    );
  } catch (caught) {
    error = caught as Error;
  }

  const capture = (await readFile(capturePath, 'utf8'))
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as CaptureEntry);
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
    return true;
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
  assert.equal(prompt?.toolName, 'question');
  assert.deepEqual(prompt?.input, {
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
  assert.equal((prompt?.context as AnyRecord).answerFormat, 'label-lists');
  assert.deepEqual(turn.requests('POST', '/question/que_1/reply').map((entry) => entry.body), [
    { answers: [['Red'], ['Small', 'Large, wide', 'a custom size']] },
  ]);
  assert.equal(turn.messages.find((message) => message.kind === 'tool_use')?.toolResult?.isError, false);
});

test('skipping an agent question rejects it', async () => {
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
  assert.equal(turn.requests('POST', '/question/que_bypass/reject').length, 1);
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
