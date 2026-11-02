import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import type { ProviderPermissionDecision, ProviderRuntimeContext } from '@/shared/types.js';

/**
 * Drives the OpenCode runtime and the real `@opencode-ai/sdk` against a fake
 * `opencode serve` (tests/fixtures/fake-opencode-serve.ts) found on PATH, so
 * every turn goes through the SDK's own server start, client calls and event
 * stream without a real OpenCode or model.
 */

// Read when the runtime module loads, so set before importing it — the
// sessions provider imports the runtime too, so it is loaded dynamically as well.
process.env.OPENCODE_TOOL_APPROVAL_TIMEOUT_MS = '1500';
const {
  isCoveredByApprovals,
  opencodeRuntime,
  readQuestionAnswers,
  reapOrphanedOpenCodeServers,
  resolveAutomaticPermissionReply,
  toOpenCodePermissionReply,
} = await import('@/modules/providers/list/opencode/opencode-runtime.provider.js');
const { OpenCodeSessionsProvider } = await import('@/modules/providers/list/opencode/opencode-sessions.provider.js');

type Frame = Record<string, any>;
type LogEntry = Record<string, any>;

const TURN_DEADLINE_MS = 30_000;

const FIXTURE_PATH = fileURLToPath(new URL('./fixtures/fake-opencode-serve.ts', import.meta.url));
const TSX_LOADER = import.meta.resolve('tsx/esm');
const sessionsProvider = new OpenCodeSessionsProvider();

let tempRoot = '';
let binDir = '';
let projectDir = '';
let logCounter = 0;
const savedEnv: Record<string, string | undefined> = {};

const findEnvKey = (name: string) =>
  Object.keys(process.env).find((key) => key.toLowerCase() === name.toLowerCase()) || name;

const setEnv = (name: string, value: string | undefined) => {
  if (!(name in savedEnv)) {
    savedEnv[name] = process.env[name];
  }
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
};

before(async () => {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), 'opencode-sdk-runtime-'));
  binDir = path.join(tempRoot, 'bin');
  projectDir = path.join(tempRoot, 'project');
  await Promise.all([mkdir(binDir), mkdir(projectDir)]);

  // `opencode` on PATH runs the fixture through tsx, as the real CLI would run.
  if (process.platform === 'win32') {
    await writeFile(
      path.join(binDir, 'opencode.cmd'),
      `@echo off\r\n"${process.execPath}" --import "${TSX_LOADER}" "${FIXTURE_PATH}" %*\r\n`,
    );
    const pathExtKey = findEnvKey('PATHEXT');
    const pathExt = process.env[pathExtKey];
    setEnv(pathExtKey, pathExt?.toUpperCase().includes('.CMD') ? pathExt : `.COM;.EXE;.BAT;.CMD${pathExt ? `;${pathExt}` : ''}`);
  } else {
    const wrapper = path.join(binDir, 'opencode');
    await writeFile(wrapper, `#!/bin/sh\nexec "${process.execPath}" --import "${TSX_LOADER}" "${FIXTURE_PATH}" "$@"\n`);
    await chmod(wrapper, 0o755);
  }

  const pathKey = findEnvKey('PATH');
  setEnv(pathKey, `${binDir}${path.delimiter}${process.env[pathKey] || ''}`);
  // Token usage is read from ~/.local/share/opencode; keep the real one out of it.
  setEnv('HOME', tempRoot);
  setEnv('USERPROFILE', tempRoot);
  setEnv('OPENCODE_SERVER_PASSWORD', undefined);
});

after(async () => {
  for (const [name, value] of Object.entries(savedEnv)) {
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }
  await rm(tempRoot, { recursive: true, force: true });
});

const isProcessAlive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

async function waitForExit(pid: number): Promise<boolean> {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (!isProcessAlive(pid)) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return false;
}

type TurnOptions = {
  scenario: Record<string, unknown>;
  appSessionId?: string;
  resumeSessionId?: string | null;
  command?: string;
  permissionMode?: string;
  files?: unknown[];
  installed?: boolean;
  normalizeMessage?: ProviderRuntimeContext['normalizeMessage'];
  /** Called for every frame the chat receives; return a decision to answer a permission_request. */
  onFrame?: (frame: Frame) => ProviderPermissionDecision | void;
};

async function runTurn(options: TurnOptions) {
  const logPath = path.join(tempRoot, `requests-${++logCounter}.jsonl`);
  setEnv('FAKE_OPENCODE_SCENARIO', JSON.stringify(options.scenario));
  setEnv('FAKE_OPENCODE_LOG', logPath);

  const frames: Frame[] = [];
  const writer = {
    userId: null,
    sessionId: null as string | null,
    send(message: unknown) {
      const frame = message as Frame;
      frames.push(frame);
      const decision = options.onFrame?.(frame);
      if (decision && frame.kind === 'permission_request') {
        setImmediate(() => opencodeRuntime.permissions.resolve(frame.requestId, decision));
      }
    },
    setSessionId(sessionId: string) {
      this.sessionId = sessionId;
    },
  };
  const context: ProviderRuntimeContext = {
    resolveProviderSessionId: () => options.resumeSessionId ?? null,
    resolveResumeModel: async (_sessionId, requestedModel) => requestedModel || undefined,
    getProviderModels: async () => ({ OPTIONS: [], DEFAULT: '' }),
    normalizeMessage: options.normalizeMessage ?? ((raw, sessionId) => sessionsProvider.normalizeMessage(raw, sessionId)),
    isProviderInstalled: async () => options.installed ?? true,
  };

  const appSessionId = options.appSessionId ?? 'app-session';
  const running = opencodeRuntime.run(options.command ?? 'Hi', {
    sessionId: appSessionId,
    cwd: projectDir,
    model: 'github-copilot/gpt-5.6-terra',
    permissionMode: options.permissionMode,
    files: options.files,
  }, writer, context).then(() => null, (caught: unknown) => caught as Error);
  // A turn that never ends fails its test instead of hanging the whole file.
  let deadline: ReturnType<typeof setTimeout> | undefined;
  const outcome = await Promise.race([
    running,
    new Promise<'timeout'>((resolve) => {
      deadline = setTimeout(() => resolve('timeout'), TURN_DEADLINE_MS);
    }),
  ]);
  clearTimeout(deadline);
  if (outcome === 'timeout') {
    await Promise.race([opencodeRuntime.abort(appSessionId), new Promise((resolve) => setTimeout(resolve, 5000))]);
    throw new Error(`The turn did not finish within ${TURN_DEADLINE_MS / 1000} s.`);
  }
  const error = outcome;

  let requests: LogEntry[] = [];
  try {
    requests = (await readFile(logPath, 'utf8')).trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
  } catch {
    // No server ever started.
  }
  const started = requests.find((entry) => entry.started);
  return {
    frames,
    error,
    writer,
    requests: requests.filter((entry) => !entry.started),
    serverPid: started?.pid as number | undefined,
    started,
  };
}

const kinds = (frames: Frame[]) => frames.map((frame) => frame.kind);
const findRequest = (requests: LogEntry[], method: string, pathPattern: RegExp) =>
  requests.find((entry) => entry.method === method && pathPattern.test(entry.path));

const permissionStep = (patterns: string[], always: string[], permission = 'bash', id = 'per_1') => ({
  type: 'permission',
  id,
  permission,
  patterns,
  always,
  metadata: { command: patterns[0] },
});

const questionStep = {
  type: 'question',
  id: 'que_1',
  questions: [
    { question: 'Which color?', header: 'Color', options: [{ label: 'Red', description: '' }, { label: 'Blue', description: '' }] },
    {
      question: 'Which sizes?',
      header: 'Sizes',
      multiple: true,
      options: [{ label: 'Small', description: '' }, { label: 'Large, wide', description: '' }],
    },
  ],
};

test('a new session runs on a private, authenticated server that stops with the turn', async () => {
  const turn = await runTurn({
    scenario: { newSessionId: 'ses_new', steps: [{ type: 'reasoning', text: 'thinking it over' }, { type: 'text', text: 'assistant response' }] },
  });

  assert.equal(turn.error, null);
  assert.deepEqual(kinds(turn.frames), ['session_created', 'thinking', 'text', 'stream_end', 'complete']);
  assert.equal(turn.frames[0].newSessionId, 'ses_new');
  assert.equal(turn.writer.sessionId, 'ses_new');
  assert.equal(turn.frames[2].content, 'assistant response');
  assert.equal(turn.frames.at(-1)?.exitCode, 0);

  // Every call carried the turn's password and the chat's project directory.
  assert.ok(turn.requests.length > 0);
  for (const entry of turn.requests) {
    assert.match(String(entry.authorization), /^Basic /);
    assert.equal(entry.directory, projectDir);
  }
  const prompt = findRequest(turn.requests, 'POST', /^\/session\/ses_new\/prompt_async$/);
  assert.deepEqual(prompt?.body.model, { providerID: 'github-copilot', modelID: 'gpt-5.6-terra' });
  assert.deepEqual(prompt?.body.parts, [{ type: 'text', text: 'Hi' }]);
  assert.equal(prompt?.body.agent, undefined);

  // Loopback only, with a password of its own that never stays in CloudCLI's environment.
  assert.ok(turn.started?.args.includes('--hostname=127.0.0.1'));
  assert.equal(turn.started?.passwordSet, true);
  assert.equal(process.env.OPENCODE_SERVER_PASSWORD, undefined);
  assert.equal(process.env.CLOUDCLI_OPENCODE_OWNER_PID, undefined);

  assert.ok(turn.serverPid, 'the fake server reported its pid');
  assert.ok(await waitForExit(turn.serverPid!), 'the turn\'s server process is gone');
});

test('an attachment-only message sends the attachment list as the prompt', async () => {
  const turn = await runTurn({
    command: '',
    files: [{ path: path.join(projectDir, 'brief.pdf'), name: 'brief.pdf', mimeType: 'application/pdf' }],
    scenario: { steps: [{ type: 'text', text: 'read it' }] },
  });

  assert.equal(turn.error, null);
  const prompt = findRequest(turn.requests, 'POST', /\/prompt_async$/);
  assert.match(prompt?.body.parts[0].text, /<files_input>/);
  assert.match(prompt?.body.parts[0].text, /brief\.pdf/);
});

test('a permission request reaches the chat and is answered once', async () => {
  let pendingWhileAsked: unknown[] = [];
  const turn = await runTurn({
    appSessionId: 'app-once',
    scenario: { steps: [permissionStep(['git status'], ['git status *']), { type: 'text', text: 'done' }] },
    onFrame: (frame) => {
      if (frame.kind === 'permission_request') {
        pendingWhileAsked = opencodeRuntime.permissions.listPending('app-once');
        return { allow: true };
      }
    },
  });

  assert.equal(turn.error, null);
  const request = turn.frames.find((frame) => frame.kind === 'permission_request');
  assert.equal(request?.toolName, 'bash');
  assert.deepEqual(request?.context, { patterns: ['git status'], always: ['git status *'] });
  assert.deepEqual(request?.input, { command: 'git status', patterns: ['git status'] });
  // A client that subscribes while the prompt is open gets it replayed.
  assert.equal((pendingWhileAsked[0] as Frame | undefined)?.requestId, 'per_1');

  assert.deepEqual(findRequest(turn.requests, 'POST', /^\/permission\/per_1\/reply$/)?.body, { reply: 'once' });
  assert.ok(kinds(turn.frames).includes('permission_resolved'));
  const tool = turn.frames.find((frame) => frame.kind === 'tool_use');
  assert.equal(tool?.toolResult?.isError, false);
  assert.equal(turn.frames.at(-1)?.exitCode, 0);
  assert.deepEqual(opencodeRuntime.permissions.listPending('app-once'), []);
});

test('Always allow is remembered for the same chat, not for others', async () => {
  const first = await runTurn({
    appSessionId: 'app-always',
    scenario: { newSessionId: 'ses_always', steps: [permissionStep(['git status'], ['git status *'])] },
    onFrame: (frame) => (frame.kind === 'permission_request' ? { allow: true, rememberEntry: 'always' } : undefined),
  });
  assert.deepEqual(findRequest(first.requests, 'POST', /\/permission\/per_1\/reply$/)?.body, { reply: 'always' });

  // The next turn's server knows nothing of it, so CloudCLI answers for the chat.
  const second = await runTurn({
    appSessionId: 'app-always',
    resumeSessionId: 'ses_always',
    scenario: { sessions: { ses_always: {} }, steps: [permissionStep(['git status --short'], ['git status *'], 'bash', 'per_2')] },
    onFrame: (frame) => (frame.kind === 'permission_request' ? { allow: false } : undefined),
  });
  assert.equal(second.frames.some((frame) => frame.kind === 'permission_request'), false);
  assert.deepEqual(findRequest(second.requests, 'POST', /\/permission\/per_2\/reply$/)?.body, { reply: 'once' });

  // A command the approval does not cover is still asked.
  const uncovered = await runTurn({
    appSessionId: 'app-always',
    resumeSessionId: 'ses_always',
    scenario: { sessions: { ses_always: {} }, steps: [permissionStep(['git push'], ['git push *'], 'bash', 'per_3')] },
    onFrame: (frame) => (frame.kind === 'permission_request' ? { allow: true } : undefined),
  });
  assert.equal(uncovered.frames.filter((frame) => frame.kind === 'permission_request').length, 1);

  const otherChat = await runTurn({
    appSessionId: 'app-other',
    scenario: { steps: [permissionStep(['git status'], ['git status *'], 'bash', 'per_4')] },
    onFrame: (frame) => (frame.kind === 'permission_request' ? { allow: true } : undefined),
  });
  assert.equal(otherChat.frames.filter((frame) => frame.kind === 'permission_request').length, 1);
});

test('Deny rejects the request, which ends the turn like OpenCode\'s own Reject', async () => {
  const turn = await runTurn({
    scenario: { steps: [permissionStep(['rm -rf build'], ['rm *']), { type: 'text', text: 'never reached' }] },
    onFrame: (frame) => (frame.kind === 'permission_request' ? { allow: false, message: 'User denied tool use' } : undefined),
  });

  assert.equal(turn.error, null);
  assert.deepEqual(findRequest(turn.requests, 'POST', /\/permission\/per_1\/reply$/)?.body, { reply: 'reject' });
  assert.equal(turn.frames.find((frame) => frame.kind === 'tool_use')?.toolResult?.isError, true);
  assert.equal(turn.frames.some((frame) => frame.kind === 'text'), false);
  assert.equal(turn.frames.at(-1)?.kind, 'complete');
});

test('a reply OpenCode has already settled is not a failure', async () => {
  // The chat's answer and OpenCode's own cascade raced: the reply gets the 404
  // OpenCode sends for a request it no longer knows.
  const turn = await runTurn({
    scenario: { replyNotFound: ['per_1'], steps: [permissionStep(['git push'], ['git push *']), { type: 'text', text: 'never reached' }] },
    onFrame: (frame) => (frame.kind === 'permission_request' ? { allow: true } : undefined),
  });

  assert.equal(turn.error, null);
  assert.ok(findRequest(turn.requests, 'POST', /\/permission\/per_1\/reply$/));
  assert.equal(turn.frames.some((frame) => frame.kind === 'error'), false);
  assert.equal(turn.frames.at(-1)?.exitCode, 0);
});

test('an unanswered permission is rejected once its timeout runs out', async () => {
  const turn = await runTurn({ scenario: { steps: [permissionStep(['make deploy'], ['make *'])] } });

  const cancelled = turn.frames.find((frame) => frame.kind === 'permission_cancelled');
  assert.equal(cancelled?.reason, 'timeout');
  assert.deepEqual(findRequest(turn.requests, 'POST', /\/permission\/per_1\/reply$/)?.body, { reply: 'reject' });
});

test('bypassPermissions answers permissions and questions without asking anyone', async () => {
  const turn = await runTurn({
    permissionMode: 'bypassPermissions',
    scenario: { steps: [permissionStep(['npm test'], ['npm *']), questionStep, { type: 'text', text: 'carried on' }] },
  });

  assert.equal(turn.error, null);
  assert.equal(turn.frames.some((frame) => frame.kind === 'permission_request'), false);
  assert.deepEqual(findRequest(turn.requests, 'POST', /\/permission\/per_1\/reply$/)?.body, { reply: 'once' });
  // Unanswered, so the agent carries on instead of the turn ending.
  assert.deepEqual(findRequest(turn.requests, 'POST', /\/question\/que_1\/reply$/)?.body, { answers: [[], []] });
  assert.ok(turn.frames.some((frame) => frame.kind === 'text' && frame.content === 'carried on'));
  // A bypassed turn does not touch the session's question rule.
  assert.equal(findRequest(turn.requests, 'PATCH', /^\/session\//), undefined);
});

test('acceptEdits approves file edits and still asks for everything else', async () => {
  const turn = await runTurn({
    permissionMode: 'acceptEdits',
    scenario: { steps: [
      permissionStep(['src/app.ts'], ['*'], 'edit', 'per_edit'),
      permissionStep(['npm install'], ['npm *'], 'bash', 'per_bash'),
    ] },
    onFrame: (frame) => (frame.kind === 'permission_request' ? { allow: true } : undefined),
  });

  const asked = turn.frames.filter((frame) => frame.kind === 'permission_request').map((frame) => frame.toolName);
  assert.deepEqual(asked, ['bash']);
  assert.deepEqual(findRequest(turn.requests, 'POST', /\/permission\/per_edit\/reply$/)?.body, { reply: 'once' });
});

test('plan mode prompts the plan agent', async () => {
  const turn = await runTurn({ permissionMode: 'plan', scenario: { steps: [{ type: 'text', text: 'a plan' }] } });

  assert.equal(findRequest(turn.requests, 'POST', /\/prompt_async$/)?.body.agent, 'plan');
});

test('a question is answered with one label list per question and shown as a question card', async () => {
  const turn = await runTurn({
    scenario: { steps: [questionStep] },
    onFrame: (frame) => (frame.kind === 'permission_request'
      ? { allow: true, updatedInput: { answers: [['Red'], ['Small', 'Large, wide']] } }
      : undefined),
  });

  const request = turn.frames.find((frame) => frame.kind === 'permission_request');
  assert.equal(request?.toolName, 'AskUserQuestion');
  assert.deepEqual(request?.context, { answerFormat: 'label-lists' });
  assert.equal(request?.input.questions[1].multiSelect, true);
  assert.deepEqual(
    findRequest(turn.requests, 'POST', /^\/question\/que_1\/reply$/)?.body,
    { answers: [['Red'], ['Small', 'Large, wide']] },
  );

  const card = turn.frames.find((frame) => frame.kind === 'tool_use');
  assert.equal(card?.toolName, 'AskUserQuestion');
  assert.deepEqual(card?.toolInput.answers, { 'Which color?': 'Red', 'Which sizes?': 'Small, Large, wide' });
});

test('dismissing a question rejects it', async () => {
  const turn = await runTurn({
    scenario: { steps: [questionStep, { type: 'text', text: 'never reached' }] },
    onFrame: (frame) => (frame.kind === 'permission_request' ? { allow: false } : undefined),
  });

  assert.ok(findRequest(turn.requests, 'POST', /^\/question\/que_1\/reject$/));
  assert.equal(turn.frames.some((frame) => frame.kind === 'text'), false);
});

test('stopping a turn withdraws its prompt, aborts the session and settles after the stop', async () => {
  let abortReturnedAt = 0;
  let abortResult: boolean | null = null;
  const turnPromise = runTurn({
    appSessionId: 'app-abort',
    scenario: { steps: [permissionStep(['sleep 100'], ['sleep *'])] },
    onFrame: (frame) => {
      if (frame.kind === 'permission_request') {
        void opencodeRuntime.abort('app-abort').then((result: boolean) => {
          abortResult = result;
          abortReturnedAt = performance.now();
        });
      }
    },
  });
  const turn = await turnPromise;
  const settledAt = performance.now();

  assert.equal(turn.error, null);
  assert.equal(abortResult, true);
  assert.ok(abortReturnedAt > 0 && abortReturnedAt <= settledAt, 'the turn settles only after its abort returned');
  assert.equal(turn.frames.find((frame) => frame.kind === 'permission_cancelled')?.reason, 'cancelled');
  assert.ok(findRequest(turn.requests, 'POST', /^\/session\/[^/]+\/abort$/));
  // The chat's abort handler sends the terminal complete, not the runtime.
  assert.equal(turn.frames.some((frame) => frame.kind === 'complete' || frame.kind === 'error'), false);
  assert.ok(await waitForExit(turn.serverPid!), 'the stopped turn\'s server process is gone');
  assert.equal(await opencodeRuntime.abort('app-abort'), false);
});

test('a second stop waits for the first and reports the turn stopped only once it is', async () => {
  const results: boolean[] = [];
  let abortsSettledAt = 0;
  const turn = await runTurn({
    appSessionId: 'app-double-stop',
    // OpenCode takes a while to confirm the first stop.
    scenario: { abortDelayMs: 600, steps: [permissionStep(['sleep 100'], ['sleep *'])] },
    onFrame: (frame) => {
      if (frame.kind === 'permission_request') {
        void Promise.all([
          opencodeRuntime.abort('app-double-stop'),
          new Promise<boolean>((resolve) => setTimeout(() => resolve(opencodeRuntime.abort('app-double-stop')), 50)),
        ]).then((values) => {
          results.push(...values);
          abortsSettledAt = performance.now();
        });
      }
    },
  });
  const settledAt = performance.now();

  assert.equal(turn.error, null);
  assert.deepEqual(results, [true, true]);
  assert.ok(abortsSettledAt > 0 && abortsSettledAt <= settledAt);
  assert.equal(turn.frames.filter((frame) => frame.kind === 'complete').length, 0);
});

test('a request raised while the turn is stopping never reaches the chat', async () => {
  const turn = await runTurn({
    appSessionId: 'app-late-ask',
    scenario: {
      // The abort takes a moment, so the late question arrives while it is pending.
      abortDelayMs: 300,
      askOnAbort: { id: 'que_late', questions: questionStep.questions },
      steps: [permissionStep(['sleep 100'], ['sleep *'])],
    },
    onFrame: (frame) => {
      if (frame.kind === 'permission_request' && frame.requestId === 'per_1') {
        void opencodeRuntime.abort('app-late-ask');
      }
    },
  });

  assert.equal(turn.frames.some((frame) => frame.requestId === 'que_late'), false);
  assert.deepEqual(opencodeRuntime.permissions.listPending('app-late-ask'), []);
});

test('requests OpenCode settles itself are withdrawn from the chat', async () => {
  const turn = await runTurn({
    appSessionId: 'app-cascade',
    scenario: { steps: [{
      type: 'parallel-permissions',
      requests: [
        { id: 'per_a', permission: 'bash', patterns: ['npm test'], always: ['npm *'] },
        { id: 'per_b', permission: 'bash', patterns: ['npm run lint'], always: ['npm *'] },
      ],
    }] },
    // Only the first is answered; OpenCode's reject cascade settles the second.
    onFrame: (frame) => (frame.kind === 'permission_request' && frame.requestId === 'per_a' ? { allow: false } : undefined),
  });

  const settledB = turn.frames.find((frame) => frame.requestId === 'per_b' && frame.kind !== 'permission_request');
  assert.equal(settledB?.kind, 'permission_resolved');
  assert.equal(findRequest(turn.requests, 'POST', /\/permission\/per_b\/reply$/), undefined);
  assert.deepEqual(opencodeRuntime.permissions.listPending('app-cascade'), []);
});

test('an event that cannot be handled does not end the turn', async () => {
  const turn = await runTurn({
    scenario: { steps: [{ type: 'reasoning', text: 'thinking' }, { type: 'text', text: 'still answered' }] },
    normalizeMessage: (raw, sessionId) => {
      if ((raw as { type?: string }).type === 'reasoning') {
        throw new Error('cannot normalize this one');
      }
      return sessionsProvider.normalizeMessage(raw, sessionId);
    },
  });

  assert.equal(turn.error, null);
  assert.ok(turn.frames.some((frame) => frame.kind === 'text' && frame.content === 'still answered'));
  assert.equal(turn.frames.at(-1)?.exitCode, 0);
});

test('turn servers a killed CloudCLI left running are stopped, and nothing else', { skip: process.platform !== 'linux' }, async () => {
  const deadOwner = spawn(process.execPath, ['-e', '']);
  await new Promise((resolve) => deadOwner.once('exit', resolve));
  const keepAlive = 'setInterval(() => {}, 1000)';
  const start = (args: string[], ownerPid: number) => spawn(process.execPath, ['-e', keepAlive, ...args], {
    env: { ...process.env, CLOUDCLI_OPENCODE_OWNER_PID: String(ownerPid) },
    stdio: 'ignore',
  });
  const orphan = start(['serve', '--hostname=127.0.0.1', '--port=1'], deadOwner.pid!);
  const ownedByLiveCloudCli = start(['serve', '--hostname=127.0.0.1', '--port=2'], process.pid);
  const leftoverCommand = start(['npm', 'run', 'dev'], deadOwner.pid!);
  await new Promise((resolve) => setTimeout(resolve, 300));

  try {
    assert.ok(await reapOrphanedOpenCodeServers() >= 1);
    assert.ok(await waitForExit(orphan.pid!), 'the orphaned turn server is stopped');
    assert.equal(isProcessAlive(ownedByLiveCloudCli.pid!), true, 'a live CloudCLI\'s server is left alone');
    assert.equal(isProcessAlive(leftoverCommand.pid!), true, 'a command the agent left running is left alone');
  } finally {
    for (const child of [orphan, ownedByLiveCloudCli, leftoverCommand]) {
      child.kill('SIGKILL');
    }
  }
});

test('the leftover-server sweep only trusts owner pids from its own PID namespace', { skip: process.platform !== 'linux' }, async () => {
  // A CloudCLI on the host also sees a container's processes in /proc; their
  // owner pid is the container's and would look dead from the host.
  const deadOwner = spawn(process.execPath, ['-e', '']);
  await new Promise((resolve) => deadOwner.once('exit', resolve));
  const keepAlive = 'setInterval(() => {}, 1000)';
  const sameNamespace = spawn(process.execPath, ['-e', keepAlive], { stdio: 'ignore' });
  const otherNamespace = spawn(process.execPath, ['-e', keepAlive], { stdio: 'ignore' });

  const procRoot = path.join(tempRoot, 'fake-proc');
  const addProcess = async (pid: number, namespace: string) => {
    const dir = path.join(procRoot, String(pid));
    await mkdir(path.join(dir, 'ns'), { recursive: true });
    await writeFile(path.join(dir, 'environ'), `PATH=/usr/bin\0CLOUDCLI_OPENCODE_OWNER_PID=${deadOwner.pid}\0`);
    await writeFile(path.join(dir, 'cmdline'), 'opencode\0serve\0--hostname=127.0.0.1\0--port=4242\0');
    await symlink(namespace, path.join(dir, 'ns', 'pid'));
  };
  await mkdir(path.join(procRoot, 'self', 'ns'), { recursive: true });
  await symlink('pid:[4026531836]', path.join(procRoot, 'self', 'ns', 'pid'));
  await addProcess(sameNamespace.pid!, 'pid:[4026531836]');
  await addProcess(otherNamespace.pid!, 'pid:[4026532999]');

  try {
    // Without its own namespace to compare against, it stops nothing.
    await mkdir(path.join(tempRoot, 'proc-without-self'), { recursive: true });
    assert.equal(await reapOrphanedOpenCodeServers(path.join(tempRoot, 'proc-without-self')), 0);

    assert.equal(await reapOrphanedOpenCodeServers(procRoot), 1);
    assert.ok(await waitForExit(sameNamespace.pid!), 'the leftover server of this namespace is stopped');
    assert.equal(isProcessAlive(otherNamespace.pid!), true, 'a process of another PID namespace is left alone');
  } finally {
    sameNamespace.kill('SIGKILL');
    otherNamespace.kill('SIGKILL');
  }
});

test('a session `opencode run` created gets its question tool back unless the agent denies questions', async () => {
  const legacyRules = [
    { permission: 'question', pattern: '*', action: 'deny' },
    { permission: 'plan_enter', pattern: '*', action: 'deny' },
  ];
  const resumed = await runTurn({
    resumeSessionId: 'ses_legacy',
    scenario: { sessions: { ses_legacy: { permission: legacyRules } }, steps: [{ type: 'text', text: 'hi' }] },
  });
  assert.equal(resumed.frames.some((frame) => frame.kind === 'session_created'), false);
  assert.deepEqual(
    findRequest(resumed.requests, 'PATCH', /^\/session\/ses_legacy$/)?.body,
    { permission: [{ permission: 'question', pattern: '*', action: 'allow' }] },
  );

  const userDenies = await runTurn({
    resumeSessionId: 'ses_legacy',
    scenario: {
      sessions: { ses_legacy: { permission: legacyRules } },
      agents: [{ name: 'build', permission: [{ permission: 'question', pattern: '*', action: 'deny' }] }],
      steps: [{ type: 'text', text: 'hi' }],
    },
  });
  assert.equal(findRequest(userDenies.requests, 'PATCH', /^\/session\//), undefined);
});

test('a prompt OpenCode refuses fails the turn', async () => {
  const turn = await runTurn({ scenario: { promptStatus: 400, steps: [] } });

  assert.match(String(turn.error?.message), /The prompt was refused/);
  assert.deepEqual(kinds(turn.frames), ['session_created', 'error', 'complete']);
  assert.equal(turn.frames.at(-1)?.exitCode, 1);
});

test('an error reported before the turn runs ends it with that error, once', async () => {
  const turn = await runTurn({ scenario: { steps: [{ type: 'error', name: 'ProviderModelNotFoundError', message: 'Model not found: x/y' }] } });

  assert.match(String(turn.error?.message), /Model not found/);
  assert.equal(turn.frames.filter((frame) => frame.kind === 'error').length, 1);
  assert.equal(turn.frames.at(-1)?.exitCode, 1);
});

test('a server that dies mid-turn fails the turn', async () => {
  const turn = await runTurn({ scenario: { steps: [{ type: 'text', text: 'partial' }, { type: 'crash' }] } });

  assert.ok(turn.error);
  assert.match(String(turn.frames.find((frame) => frame.kind === 'error')?.content), /OpenCode server/);
  assert.equal(turn.frames.at(-1)?.exitCode, 1);
});

test('an OpenCode too old for permission and question replies is refused before any prompt', async () => {
  const old = await runTurn({ scenario: { version: '1.0.200', steps: [{ type: 'text', text: 'never sent' }] } });
  assert.match(String(old.frames.find((frame) => frame.kind === 'error')?.content), /OpenCode 1\.0\.200 is too old.*1\.1\.8/);
  assert.equal(old.frames.at(-1)?.exitCode, 1);
  assert.equal(findRequest(old.requests, 'POST', /\/prompt_async$/), undefined);

  // 1.1.7 took one answer string per question, not label lists.
  const oneOneSeven = await runTurn({ scenario: { version: '1.1.7', steps: [] } });
  assert.match(String(oneOneSeven.frames.find((frame) => frame.kind === 'error')?.content), /OpenCode 1\.1\.7 is too old/);

  const unversioned = await runTurn({ scenario: { version: null, steps: [] } });
  assert.match(String(unversioned.frames.find((frame) => frame.kind === 'error')?.content), /needs OpenCode 1\.1\.8 or newer/);

  // Snapshot builds report 0.0.0 and are let through.
  const snapshot = await runTurn({ scenario: { version: '0.0.0-dev-202610300000', steps: [{ type: 'text', text: 'ok' }] } });
  assert.equal(snapshot.error, null);
});

test('a missing CLI is reported as not installed', async () => {
  const pathKey = findEnvKey('PATH');
  const previousPath = process.env[pathKey];
  process.env[pathKey] = path.join(tempRoot, 'empty-bin');
  try {
    const turn = await runTurn({ installed: false, scenario: { steps: [] } });
    assert.match(String(turn.frames.find((frame) => frame.kind === 'error')?.content), /OpenCode CLI is not installed/);
    assert.equal(turn.frames.at(-1)?.exitCode, 1);
  } finally {
    process.env[pathKey] = previousPath;
  }
});

test('permission modes map onto automatic replies', () => {
  assert.equal(resolveAutomaticPermissionReply('bypassPermissions', 'bash'), 'once');
  assert.equal(resolveAutomaticPermissionReply('acceptEdits', 'edit'), 'once');
  assert.equal(resolveAutomaticPermissionReply('acceptEdits', 'bash'), null);
  assert.equal(resolveAutomaticPermissionReply('plan', 'bash'), null);
  assert.equal(resolveAutomaticPermissionReply('default', 'external_directory'), null);
  assert.equal(resolveAutomaticPermissionReply(undefined, 'bash'), null);

  assert.equal(toOpenCodePermissionReply({ allow: true }), 'once');
  assert.equal(toOpenCodePermissionReply({ allow: true, rememberEntry: 'always' }), 'always');
  assert.equal(toOpenCodePermissionReply({ allow: false, rememberEntry: 'always' }), 'reject');
});

test('remembered approvals cover a request only when every pattern matches', () => {
  const approvals = [{ permission: 'bash', pattern: 'git status *' }, { permission: 'external_directory', pattern: '/home/u/.cloudcli/assets/*' }];

  assert.equal(isCoveredByApprovals(approvals, 'bash', ['git status']), true);
  assert.equal(isCoveredByApprovals(approvals, 'bash', ['git status --short']), true);
  assert.equal(isCoveredByApprovals(approvals, 'bash', ['git statusx']), false);
  assert.equal(isCoveredByApprovals(approvals, 'bash', ['git status', 'git push']), false);
  assert.equal(isCoveredByApprovals(approvals, 'edit', ['git status']), false);
  assert.equal(isCoveredByApprovals(approvals, 'external_directory', ['/home/u/.cloudcli/assets/*']), true);
  assert.equal(isCoveredByApprovals(undefined, 'bash', ['git status']), false);
  assert.equal(isCoveredByApprovals(approvals, 'bash', []), false);
});

test('question answers are read as one label list per question', () => {
  const questions = [{ question: 'Which color?' }, { question: 'Which sizes?' }];

  assert.deepEqual(readQuestionAnswers({ answers: [['Red'], ['Small', 'Large, wide']] }, questions), [['Red'], ['Small', 'Large, wide']]);
  assert.deepEqual(readQuestionAnswers({ answers: [['Red']] }, questions), [['Red'], []]);
  assert.deepEqual(readQuestionAnswers({ answers: { 'Which color?': 'Blue', 'Which sizes?': '' } }, questions), [['Blue'], []]);
  assert.deepEqual(readQuestionAnswers(undefined, questions), [[], []]);
});
