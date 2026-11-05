import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import Database from 'better-sqlite3';

import { closeConnection, initializeDatabase, sessionsDb } from '@/modules/database/index.js';
import { opencodeRuntime } from '@/modules/providers/list/opencode/opencode-runtime.provider.js';
import { OpenCodeSessionSynchronizer } from '@/modules/providers/list/opencode/opencode-session-synchronizer.provider.js';
import { opencodeSideQuestionForks } from '@/modules/providers/list/opencode/opencode-side-question-forks.js';
import type { ProviderRuntimeContext, SideQuestionOutcome, SideQuestionRequest, SideQuestionSink } from '@/shared/types.js';
import { SIDE_CONVERSATION_DEVELOPER_INSTRUCTIONS } from '@/shared/utils.js';

/**
 * An opencode side question runs on a fork of the parent session, in a private
 * `opencode serve` whose own config defines a read-only agent under a name
 * fresh for every question, and the fork is deleted afterwards. The SDK half
 * drives the runtime and the real `@opencode-ai/sdk` against the fake server
 * (tests/fixtures/fake-opencode-serve.ts) on PATH, the way
 * opencode-runtime.test.ts does, and asserts on the requests the fake logs and
 * the outcome the runtime returns, never on which prompt route or helper the
 * implementation picked. The synchronizer half runs against a fake
 * `opencode.db` and checks that a side-question fork never becomes a sidebar
 * session.
 */

const PARENT_SESSION = 'open-parent-1';
const FORK_SESSION = 'open-fork-1';
const QUESTION = 'Which file holds the router?';
const MODEL = 'github-copilot/gpt-5.6-terra';
const DISMISSED = 'The side question was dismissed.';
/** Gives the delete a window in which a fork id dropped too early would show. */
const DELETE_DELAY_MS = 400;
const ASK_DEADLINE_MS = 20_000;

/** The parent's history, which the fork copies; none of it may reach the answer. */
const HISTORY = [
  { role: 'user', text: 'HISTORY earlier question' },
  { role: 'assistant', text: 'HISTORY earlier answer' },
  { role: 'user', text: 'HISTORY follow-up' },
  { role: 'assistant', text: 'HISTORY follow-up answer' },
];

/** Unchanged from the CLI-era side question; the wildcard denial comes first because the last match wins. */
const EXPECTED_PERMISSION = {
  '*': 'deny',
  read: { '*': 'allow', '*.env': 'deny', '*.env.*': 'deny' },
  grep: 'allow',
  glob: 'allow',
  list: 'allow',
  edit: 'deny',
  bash: 'deny',
  task: 'deny',
  webfetch: 'deny',
  external_directory: 'deny',
};

type LogEntry = Record<string, any>;
type RuntimeSideQuestion = {
  askSideQuestion?: (
    request: SideQuestionRequest,
    sink: SideQuestionSink,
    context: ProviderRuntimeContext,
  ) => Promise<SideQuestionOutcome>;
};

const runtime = opencodeRuntime as unknown as RuntimeSideQuestion;
const registry = opencodeSideQuestionForks;
const context = {} as ProviderRuntimeContext;

const FIXTURE_PATH = fileURLToPath(new URL('./fixtures/fake-opencode-serve.ts', import.meta.url));
const TSX_LOADER = import.meta.resolve('tsx/esm');

let tempRoot = '';
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
  tempRoot = await mkdtemp(path.join(os.tmpdir(), 'opencode-side-question-'));
  const binDir = path.join(tempRoot, 'bin');
  projectDir = path.join(tempRoot, 'project');
  await Promise.all([mkdir(binDir), mkdir(projectDir)]);

  // `opencode` on PATH runs the fixture through tsx, as in opencode-runtime.test.ts.
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
  setEnv('HOME', tempRoot);
  setEnv('USERPROFILE', tempRoot);
  setEnv('OPENCODE_SERVER_PASSWORD', undefined);
  setEnv('OPENCODE_CONFIG_CONTENT', undefined);
  setEnv('OPENCODE_PERMISSION', undefined);
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

const settle = (ms = 20) => new Promise((resolve) => { setTimeout(resolve, ms); });

async function waitFor(condition: () => boolean | Promise<boolean>, message: string): Promise<void> {
  for (let attempt = 0; attempt < 250; attempt += 1) {
    if (await condition()) {
      return;
    }
    await settle();
  }
  assert.fail(message);
}

const isProcessAlive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

/** A scenario whose parent has history; extra fields override the defaults. */
const scenario = (overrides: Record<string, unknown> = {}) => ({
  sessions: { [PARENT_SESSION]: { title: 'Parent chat', history: HISTORY } },
  forkId: FORK_SESSION,
  deleteDelayMs: DELETE_DELAY_MS,
  steps: [{ type: 'text', text: 'Hel' }, { type: 'text', text: 'lo' }],
  ...overrides,
});

type Asking = {
  controller: AbortController;
  deltas: string[];
  /** Every line the fake logged so far, the `started` line included. */
  readLog: () => Promise<LogEntry[]>;
  /** The outcome, with the final log split into the start line and the requests. */
  finish: () => Promise<{
    outcome: SideQuestionOutcome;
    started: LogEntry | undefined;
    /** Only when the scenario delays the listening line. */
    spawned: LogEntry | undefined;
    requests: LogEntry[];
    log: LogEntry[];
  }>;
};

/** Starts one side question against the fake; `onDelta` runs synchronously inside `sink.delta`. */
function startAsk(fakeScenario: Record<string, unknown>, onDelta?: (text: string) => void): Asking {
  assert.equal(typeof runtime.askSideQuestion, 'function', 'opencodeRuntime.askSideQuestion is missing (contract: the opencode side question on the SDK)');

  const logPath = path.join(tempRoot, `side-requests-${++logCounter}.jsonl`);
  setEnv('FAKE_OPENCODE_SCENARIO', JSON.stringify(fakeScenario));
  setEnv('FAKE_OPENCODE_LOG', logPath);

  const controller = new AbortController();
  const deltas: string[] = [];
  const request: SideQuestionRequest = {
    appSessionId: 'app-opencode-session',
    providerSessionId: PARENT_SESSION,
    projectPath: projectDir,
    question: QUESTION,
    model: MODEL,
    signal: controller.signal,
  };
  const sink: SideQuestionSink = {
    delta(text) {
      deltas.push(text);
      onDelta?.(text);
    },
  };
  const pending = runtime.askSideQuestion!(request, sink, context)
    .then((outcome) => ({ outcome }), (caught: unknown) => ({ rejected: caught }));

  const readLog = async (): Promise<LogEntry[]> => {
    try {
      return (await readFile(logPath, 'utf8')).split('\n').filter((line) => line.trim()).map((line) => JSON.parse(line));
    } catch {
      return [];
    }
  };

  const finish = async () => {
    let deadline: ReturnType<typeof setTimeout> | undefined;
    const settled = await Promise.race([
      pending,
      new Promise<'timeout'>((resolve) => {
        deadline = setTimeout(() => resolve('timeout'), ASK_DEADLINE_MS);
      }),
    ]);
    clearTimeout(deadline);
    if (settled === 'timeout') {
      controller.abort();
      assert.fail(`The side question did not finish within ${ASK_DEADLINE_MS / 1000} s.`);
    }
    assert.ok(!('rejected' in settled), `askSideQuestion rejected instead of returning an error outcome: ${String((settled as { rejected?: unknown }).rejected)}`);
    const deltasAtOutcome = deltas.length;
    await settle(100);
    assert.equal(deltas.length, deltasAtOutcome, 'no sink.delta call after the outcome resolved');
    assert.deepEqual(registry.listPending(), [], 'no pending fork marker is left once the outcome arrived');
    const log = await readLog();
    return {
      outcome: settled.outcome,
      started: log.find((entry) => entry.started),
      spawned: log.find((entry) => entry.spawned),
      requests: log.filter((entry) => typeof entry.method === 'string'),
      log,
    };
  };

  return { controller, deltas, readLog, finish };
}

const ask = (fakeScenario: Record<string, unknown>, onDelta?: (text: string) => void) => startAsk(fakeScenario, onDelta).finish();

const isForkRequest = (entry: LogEntry) => entry.method === 'POST' && entry.path === `/session/${PARENT_SESSION}/fork`;
/** Either prompt route; which one the implementation uses is its choice. */
const isForkPrompt = (entry: LogEntry) => entry.method === 'POST'
  && (entry.path === `/session/${FORK_SESSION}/prompt_async` || entry.path === `/session/${FORK_SESSION}/message`);
const isForkDelete = (entry: LogEntry) => entry.method === 'DELETE' && entry.path === `/session/${FORK_SESSION}`;

function promptOf(requests: LogEntry[]): LogEntry {
  const prompts = requests.filter(isForkPrompt);
  assert.equal(prompts.length, 1, 'exactly one prompt is sent to the fork');
  return prompts[0];
}

function agentConfig(started: LogEntry | undefined, agentName: string): Record<string, any> {
  assert.ok(started, 'the side question started an opencode serve');
  assert.equal(typeof started.configContent, 'string', 'the server got OPENCODE_CONFIG_CONTENT');
  const config = JSON.parse(started.configContent);
  const agent = config.agent?.[agentName];
  assert.ok(agent, `the server's own config defines the agent the question runs under (${agentName})`);
  return agent;
}

/** The parent is only read and forked, before the fork or after it: no update, prompt, abort or delete. */
function assertParentOnlyReadAndForked(requests: LogEntry[]): void {
  assert.ok(requests.some(isForkRequest), `the parent ${PARENT_SESSION} was forked`);
  const writes = requests.filter((entry) => typeof entry.path === 'string'
    && (entry.path === `/session/${PARENT_SESSION}` || entry.path.startsWith(`/session/${PARENT_SESSION}/`))
    && entry.method !== 'GET'
    && !isForkRequest(entry));
  assert.deepEqual(writes.map((entry) => `${entry.method} ${entry.path}`), [], 'the parent session is only read and forked');
}

/**
 * A name no config can predict: at least 8 suffix characters and not a
 * counter. A full randomUUID() qualifies; an 8-character hex slice of one is
 * all digits about 2 % of the time and would make this flaky.
 */
function assertFreshAgentName(name: string): void {
  const match = /^sidequestion-([A-Za-z0-9-]+)$/.exec(name);
  assert.ok(match, `the agent is sidequestion-<letters, digits, -> (got ${name})`);
  assert.ok(match[1].length >= 8, `the suffix has at least 8 characters (got ${name})`);
  assert.doesNotMatch(match[1], /^[0-9]+$/, `the suffix is not a counter (got ${name})`);
  // The synchronizer hides forks by exactly this shape, and only this shape,
  // so a user's own \`sidequestion-review\` agent stays in the sidebar.
  assert.match(match[1], /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/, `the suffix is a lowercase UUID (got ${name})`);
}

function assertForkDeleted(log: LogEntry[]): void {
  assert.ok(log.some(isForkDelete), `DELETE /session/${FORK_SESSION} was sent`);
  assert.ok(log.some((entry) => entry.deleteFinished === FORK_SESSION), 'the fork\'s delete finished before the outcome');
  assert.equal(registry.has(FORK_SESSION), false, 'the fork id has left the registry');
}

async function assertServerGone(started: LogEntry | undefined): Promise<void> {
  assert.ok(started?.pid, 'the side question started an opencode serve');
  await waitFor(() => !isProcessAlive(started.pid), `the side question's opencode serve (pid ${started.pid}) is stopped`);
}

test('the question runs on a fork of the parent, with the request\'s model, under a sidequestion-<suffix> agent', async () => {
  const { outcome, requests } = await ask(scenario());
  assert.equal(outcome.status, 'done');

  const fork = requests.find(isForkRequest);
  assert.ok(fork, `POST /session/${PARENT_SESSION}/fork was sent`);
  assert.equal(fork.directory, projectDir, 'the fork is asked for in the request\'s project directory');

  const prompt = promptOf(requests);
  assertFreshAgentName(String(prompt.body?.agent));
  assert.deepEqual(prompt.body?.model, { providerID: 'github-copilot', modelID: 'gpt-5.6-terra' });
  assert.ok(
    (prompt.body?.parts ?? []).some((part: LogEntry) => part.type === 'text' && part.text === QUESTION),
    'the question is the prompt\'s text',
  );
});

test('the server\'s own config defines that agent with exactly the read-only permission and the side instructions', async () => {
  const { started, requests } = await ask(scenario());
  const agentName = String(promptOf(requests).body?.agent);
  const agent = agentConfig(started, agentName);

  assert.ok(['primary', 'all'].includes(agent.mode), `the agent can be prompted directly (mode ${agent.mode})`);
  assert.equal(agent.prompt, SIDE_CONVERSATION_DEVELOPER_INSTRUCTIONS);
  assert.deepEqual(agent.permission, EXPECTED_PERMISSION, 'the permission map is exactly ours');
  assert.deepEqual(Object.keys(agent.permission), Object.keys(EXPECTED_PERMISSION), 'in our order, the wildcard denial first');
});

test('every side question gets its own agent name, so a user sidequestion agent cannot shape it, and the rest of the user config stays', async () => {
  const userConfig = {
    model: 'user/own-model',
    agent: {
      mine: { mode: 'subagent', prompt: 'user agent' },
      // 'github_*' is a key ours does not set: merged into our agent, it would
      // land after '*': 'deny' and, last match winning, let an MCP tool run.
      sidequestion: { prompt: 'user prompt', permission: { bash: 'allow', 'github_*': 'allow' } },
    },
  };
  setEnv('OPENCODE_CONFIG_CONTENT', JSON.stringify(userConfig));
  try {
    const names: string[] = [];
    for (let round = 0; round < 2; round += 1) {
      const { started, requests } = await ask(scenario());
      const agentName = String(promptOf(requests).body?.agent);
      names.push(agentName);
      assertFreshAgentName(agentName);
      assert.notEqual(agentName, 'sidequestion', 'not the name a user config can predict');

      const agent = agentConfig(started, agentName);
      assert.equal(agent.prompt, SIDE_CONVERSATION_DEVELOPER_INSTRUCTIONS);
      assert.deepEqual(agent.permission, EXPECTED_PERMISSION, 'no user permission key reaches our agent');
      assert.deepEqual(Object.keys(agent.permission), Object.keys(EXPECTED_PERMISSION));

      const config = JSON.parse(started!.configContent);
      assert.equal(config.model, 'user/own-model', 'the user\'s own keys stay');
      assert.deepEqual(config.agent?.mine, userConfig.agent.mine, 'the user\'s own agents stay');
    }
    assert.notEqual(names[0], names[1], 'two side questions use two agent names');
  } finally {
    setEnv('OPENCODE_CONFIG_CONTENT', undefined);
  }
});

test('OPENCODE_PERMISSION never reaches the side question\'s server and stays set for this process', async () => {
  const userPermission = JSON.stringify({ edit: 'allow', bash: 'allow' });
  setEnv('OPENCODE_PERMISSION', userPermission);
  try {
    const { started } = await ask(scenario());
    assert.ok(started, 'the side question started an opencode serve');
    assert.equal(started.permissionEnvSet, false, 'OPENCODE_PERMISSION is absent from the server\'s environment');
    assert.equal(process.env.OPENCODE_PERMISSION, userPermission, 'it is restored once the server is spawned');
  } finally {
    setEnv('OPENCODE_PERMISSION', undefined);
  }
});

test('only the answer streams: deltas and outcome hold neither the question, the reasoning nor the copied history', async () => {
  const asking = startAsk(scenario({
    steps: [{ type: 'text', text: 'Hel' }, { type: 'reasoning', text: 'REASONING about the router' }, { type: 'text', text: 'lo' }],
  }));
  const { outcome, log, requests } = await asking.finish();
  assert.deepEqual(asking.deltas, ['Hel', 'lo'], 'each piece of the answer streams as it arrives');
  assert.deepEqual(outcome, { status: 'done', answer: 'Hello' });
  assert.ok(!asking.deltas.some((delta) => delta.includes('REASONING')), 'no reasoning streams');
  assert.ok(!outcome.answer.includes('REASONING'), 'no reasoning is in the answer');
  // Guards the fixture: the copies really were published, some after the fork's response.
  assert.ok(log.some((entry) => entry.publishedLateCopies === FORK_SESSION && entry.count > 0), 'the fake published copied history after the fork');
  assertParentOnlyReadAndForked(requests);
});

test('the fork id is registered while the answer runs and leaves the registry only after its delete finished', async () => {
  const seenWhileAnswering: boolean[] = [];
  const asking = startAsk(scenario(), () => {
    seenWhileAnswering.push(registry.has(FORK_SESSION));
  });

  // Sample the registry while the fake is still running the delete.
  const duringDelete: boolean[] = [];
  let done = false;
  const sampling = (async () => {
    while (!done) {
      const log = await asking.readLog();
      if (log.some(isForkDelete) && !log.some((entry) => entry.deleteFinished === FORK_SESSION)) {
        duringDelete.push(registry.has(FORK_SESSION));
      }
      await settle(10);
    }
  })();
  let result: Awaited<ReturnType<Asking['finish']>>;
  try {
    result = await asking.finish();
  } finally {
    done = true;
    await sampling;
  }

  assert.ok(seenWhileAnswering.length > 0, 'the answer streamed');
  assert.ok(seenWhileAnswering.every(Boolean), 'the fork id is in the registry while the answer streams');
  assert.ok(duringDelete.length > 0, 'the registry was sampled while the delete ran');
  assert.ok(duringDelete.every(Boolean), 'the fork id stays registered until its delete finished');
  assertForkDeleted(result.log);
});

test('a model error mid-answer is an error outcome with the partial answer, and the fork is deleted', async () => {
  const { outcome, log, requests, started } = await ask(scenario({
    steps: [{ type: 'text', text: 'Partial' }, { type: 'model-error', name: 'UnknownError', message: 'provider exploded' }],
  }));
  assert.equal(outcome.status, 'error');
  assert.equal(outcome.answer, 'Partial');
  assert.match((outcome as { error: string }).error, /provider exploded/, 'the provider\'s message reaches the error');
  assertForkDeleted(log);
  assertParentOnlyReadAndForked(requests);
  await assertServerGone(started);
});

test('a prompt that fails before the answer starts is an error outcome, and the fork is deleted', async () => {
  // OpenCode reports such a failure with session.error alone, never busy or idle.
  const { outcome, log, started, requests } = await ask(scenario({
    steps: [{ type: 'error', name: 'ProviderAuthError', message: 'no credentials for github-copilot' }],
  }));
  assert.equal(outcome.status, 'error');
  assert.equal(outcome.answer, '');
  assert.match((outcome as { error: string }).error, /no credentials for github-copilot/);
  assertForkDeleted(log);
  assertParentOnlyReadAndForked(requests);
  await assertServerGone(started);
});

test('a prompt the server refuses is an error outcome, and the fork is deleted', async () => {
  const { outcome, log, started, requests } = await ask(scenario({ promptStatus: 400 }));
  assert.equal(outcome.status, 'error');
  assert.equal(outcome.answer, '');
  assertForkDeleted(log);
  assertParentOnlyReadAndForked(requests);
  await assertServerGone(started);
});

test('dismissing mid-answer stops the answer on the fork, deletes the fork and stops the server', async () => {
  const asking = startAsk(scenario({ steps: [{ type: 'text', text: 'Partial' }, { type: 'hang' }] }));
  await waitFor(() => asking.deltas.length > 0, 'the answer streamed before the dismiss');
  asking.controller.abort();
  const { outcome, log, requests, started } = await asking.finish();

  assert.deepEqual(outcome, { status: 'error', error: DISMISSED, answer: 'Partial' });
  assert.ok(requests.some((entry) => entry.method === 'POST' && entry.path === `/session/${FORK_SESSION}/abort`), 'the fork\'s answer is aborted');
  assertForkDeleted(log);
  assertParentOnlyReadAndForked(requests);
  await assertServerGone(started);
});

test('dismissing while the fork is created lets the fork finish, deletes it, never prompts it and stops the server', async () => {
  const asking = startAsk(scenario({ forkDelayMs: 600 }));
  await waitFor(async () => (await asking.readLog()).some(isForkRequest), 'the fork was requested');
  assert.ok(
    registry.listPending().some((marker) => marker.directory === projectDir),
    'the pending fork marker holds the project directory while the fork is created',
  );
  asking.controller.abort();
  const { outcome, log, requests, started } = await asking.finish();

  assert.deepEqual(outcome, { status: 'error', error: DISMISSED, answer: '' });
  assert.deepEqual(requests.filter(isForkPrompt), [], 'a dismissed side question never prompts the fork');
  assertForkDeleted(log);
  assertParentOnlyReadAndForked(requests);
  await assertServerGone(started);
});

test('a server that dies mid-answer is an error outcome within the deadline, and no opencode serve is left', async () => {
  // The fork can no longer be deleted; the outcome must still arrive.
  const { outcome, started, requests } = await ask(scenario({ steps: [{ type: 'text', text: 'Partial' }, { type: 'crash' }] }));
  assert.equal(outcome.status, 'error');
  assert.ok(requests.some(isForkPrompt), 'the answer had started');
  assertParentOnlyReadAndForked(requests);
  await assertServerGone(started);
});

test('a fork the server cannot create is an error outcome: nothing is prompted and the server is stopped', async () => {
  // The parent stays readable; only the fork route answers 404.
  const { outcome, started, requests } = await ask(scenario({ forkStatus: 404 }));
  assert.equal(outcome.status, 'error');
  assert.equal(outcome.answer, '');
  assert.ok(requests.some(isForkRequest), 'the fork was asked for');
  assert.deepEqual(
    requests.filter((entry) => entry.method === 'POST' && /\/(prompt_async|message)$/.test(entry.path)).map((entry) => entry.path),
    [],
    'nothing is prompted',
  );
  assertParentOnlyReadAndForked(requests);
  await assertServerGone(started);
});

test('dismissing while the server starts is the dismissed outcome, with no fork and no server left', async () => {
  const asking = startAsk(scenario({ listenDelayMs: 800 }));
  await waitFor(async () => (await asking.readLog()).some((entry) => entry.spawned), 'the server was spawned');
  asking.controller.abort();
  const { outcome, log, spawned } = await asking.finish();

  assert.deepEqual(outcome, { status: 'error', error: DISMISSED, answer: '' });
  assert.equal(log.some(isForkRequest), false, 'no fork is created');
  assert.ok(spawned?.pid, 'the spawned server logged its pid');
  await waitFor(() => !isProcessAlive(spawned.pid), `the starting opencode serve (pid ${spawned.pid}) is stopped`);
});

test('the private server is started like a turn\'s, visible to the orphan reaper, and gone once the outcome arrives', async () => {
  const { outcome, started, log, requests } = await ask(scenario());
  assert.equal(outcome.status, 'done');
  assert.ok(started, 'the side question started an opencode serve');
  assert.equal(started.ownerPid, String(process.pid), 'the server carries this process as its owner');
  assert.ok(started.args.includes('--hostname=127.0.0.1'), 'it listens on loopback only');
  assert.equal(started.passwordSet, true, 'it is protected by its own password, like a turn\'s server');
  assertForkDeleted(log);
  assertParentOnlyReadAndForked(requests);
  await assertServerGone(started);
});

// The synchronizer, against a fake opencode.db in a patched home directory.

const patchHomeDir = (nextHomeDir: string) => {
  const original = os.homedir;
  (os as { homedir: () => string }).homedir = () => nextHomeDir;
  return () => { (os as { homedir: () => string }).homedir = original; };
};

type SessionRow = { id: string; agent: string | null; updated: number };

async function createOpenCodeDatabase(homeDir: string, workspacePath: string, sessions: SessionRow[]): Promise<string> {
  const dataDir = path.join(homeDir, '.local', 'share', 'opencode');
  await mkdir(dataDir, { recursive: true });
  const dbPath = path.join(dataDir, 'opencode.db');
  const db = new Database(dbPath);
  try {
    db.exec(`
      CREATE TABLE project (id TEXT PRIMARY KEY, worktree TEXT);
      CREATE TABLE session (
        id TEXT PRIMARY KEY, project_id TEXT, parent_id TEXT, directory TEXT, title TEXT,
        time_created INTEGER, time_updated INTEGER, time_archived INTEGER, agent TEXT
      );
      CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT, time_created INTEGER, data TEXT);
      CREATE TABLE part (id TEXT PRIMARY KEY, message_id TEXT, session_id TEXT, time_created INTEGER, data TEXT);
    `);
    db.prepare('INSERT INTO project (id, worktree) VALUES (?, ?)').run('project-1', workspacePath);
    const insert = db.prepare(`
      INSERT INTO session (id, project_id, parent_id, directory, title, time_created, time_updated, time_archived, agent)
      VALUES (?, 'project-1', NULL, ?, ?, ?, ?, NULL, ?)
    `);
    for (const session of sessions) {
      insert.run(session.id, workspacePath, `Title of ${session.id}`, 1_700_000_000_000, session.updated, session.agent);
    }
  } finally {
    db.close();
  }
  return dbPath;
}

async function withSynchronizerFixture(
  sessions: SessionRow[],
  runTest: (fixture: { workspacePath: string; dbPath: string }) => Promise<void>,
): Promise<void> {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'opencode-side-sync-'));
  const workspacePath = path.join(tempRoot, 'workspace');
  await mkdir(workspacePath, { recursive: true });
  const restoreHomeDir = patchHomeDir(tempRoot);
  const previousDatabasePath = process.env.DATABASE_PATH;

  try {
    const dbPath = await createOpenCodeDatabase(tempRoot, workspacePath, sessions);
    closeConnection();
    process.env.DATABASE_PATH = path.join(tempRoot, 'auth.db');
    await initializeDatabase();
    await runTest({ workspacePath, dbPath });
  } finally {
    closeConnection();
    if (previousDatabasePath === undefined) {
      delete process.env.DATABASE_PATH;
    } else {
      process.env.DATABASE_PATH = previousDatabasePath;
    }
    restoreHomeDir();
    await rm(tempRoot, { recursive: true, force: true });
  }
}

const AGENT_FORK = 'open-fork-agent';
const REGISTERED_FORK = 'open-fork-registered';

function assertForksUnindexed(): void {
  for (const forkId of [AGENT_FORK, REGISTERED_FORK]) {
    assert.equal(sessionsDb.getSessionByProviderSessionId(forkId), null, `${forkId} is not bound to any app session`);
    assert.equal(sessionsDb.getSessionById(forkId), null, `${forkId} is not indexed as a session`);
  }
}

test('synchronize skips side-question forks and still binds the parent to its pending app session', { concurrency: false }, async () => {
  registry.add(REGISTERED_FORK);
  try {
    // The forks are newer than the parent, so a fork would be bound first.
    await withSynchronizerFixture([
      { id: PARENT_SESSION, agent: 'build', updated: 1_700_000_001_000 },
      { id: AGENT_FORK, agent: 'sidequestion', updated: 1_700_000_002_000 },
      { id: REGISTERED_FORK, agent: null, updated: 1_700_000_003_000 },
    ], async ({ workspacePath }) => {
      sessionsDb.createAppSession('app-pending', 'opencode', workspacePath);
      await new OpenCodeSessionSynchronizer().synchronize();

      assertForksUnindexed();
      assert.equal(sessionsDb.getSessionById('app-pending')?.provider_session_id, PARENT_SESSION);
      assert.equal(sessionsDb.getAllSessions().length, 1);
    });
  } finally {
    registry.delete(REGISTERED_FORK);
  }
});

test('synchronizeFile skips an agent-marked fork that is the newest row and indexes the parent instead', { concurrency: false }, async () => {
  await withSynchronizerFixture([
    { id: PARENT_SESSION, agent: 'build', updated: 1_700_000_001_000 },
    { id: AGENT_FORK, agent: 'sidequestion', updated: 1_700_000_002_000 },
  ], async ({ workspacePath, dbPath }) => {
    sessionsDb.createAppSession('app-pending', 'opencode', workspacePath);
    const sessionId = await new OpenCodeSessionSynchronizer().synchronizeFile(dbPath);

    assert.equal(sessionId, 'app-pending', 'the parent\'s update is still reported');
    assert.equal(sessionsDb.getSessionById('app-pending')?.provider_session_id, PARENT_SESSION);
    assert.equal(sessionsDb.getSessionByProviderSessionId(AGENT_FORK), null);
    assert.equal(sessionsDb.getAllSessions().length, 1);
  });
});

test('synchronizeFile skips a registered fork that is the newest row and indexes the parent instead', { concurrency: false }, async () => {
  registry.add(REGISTERED_FORK);
  try {
    await withSynchronizerFixture([
      { id: PARENT_SESSION, agent: 'build', updated: 1_700_000_001_000 },
      { id: REGISTERED_FORK, agent: null, updated: 1_700_000_003_000 },
    ], async ({ workspacePath, dbPath }) => {
      sessionsDb.createAppSession('app-pending', 'opencode', workspacePath);
      const sessionId = await new OpenCodeSessionSynchronizer().synchronizeFile(dbPath);

      assert.equal(sessionId, 'app-pending', 'the parent\'s update is still reported');
      assert.equal(sessionsDb.getSessionById('app-pending')?.provider_session_id, PARENT_SESSION);
      assert.equal(sessionsDb.getSessionByProviderSessionId(REGISTERED_FORK), null);
      assert.equal(sessionsDb.getAllSessions().length, 1);
    });
  } finally {
    registry.delete(REGISTERED_FORK);
  }
});

test('synchronize skips a fork whose agent is a per-question sidequestion-<uuid> name, and only such names', { concurrency: false }, async () => {
  const SUFFIX_FORK = 'open-fork-suffixed';
  // Users' own agents that merely start with the word, older than the parent
  // so the parent still takes the pending app session.
  const USER_AGENT_SESSION = 'open-user-agent';
  const USER_DASHED_AGENT_SESSION = 'open-user-dashed-agent';
  await withSynchronizerFixture([
    { id: USER_AGENT_SESSION, agent: 'sidequestioner', updated: 1_700_000_000_500 },
    { id: USER_DASHED_AGENT_SESSION, agent: 'sidequestion-review', updated: 1_700_000_000_700 },
    { id: PARENT_SESSION, agent: 'build', updated: 1_700_000_001_000 },
    { id: SUFFIX_FORK, agent: 'sidequestion-3f2b8c1e-9a4d-4e7b-8c6f-1d2e3f4a5b6c', updated: 1_700_000_002_000 },
  ], async ({ workspacePath, dbPath }) => {
    sessionsDb.createAppSession('app-pending', 'opencode', workspacePath);
    const sessionId = await new OpenCodeSessionSynchronizer().synchronizeFile(dbPath);
    await new OpenCodeSessionSynchronizer().synchronize();

    assert.equal(sessionId, 'app-pending', 'the parent\'s update is still reported');
    assert.equal(sessionsDb.getSessionById('app-pending')?.provider_session_id, PARENT_SESSION);
    assert.equal(sessionsDb.getSessionByProviderSessionId(SUFFIX_FORK), null, `${SUFFIX_FORK} is not bound to any app session`);
    assert.equal(sessionsDb.getSessionById(SUFFIX_FORK), null, `${SUFFIX_FORK} is not indexed as a session`);
    assert.ok(sessionsDb.getSessionByProviderSessionId(USER_AGENT_SESSION), 'a sidequestioner agent\'s session stays indexed');
    assert.ok(sessionsDb.getSessionByProviderSessionId(USER_DASHED_AGENT_SESSION), 'a sidequestion-review agent\'s session stays indexed');
    assert.equal(sessionsDb.getAllSessions().length, 3);
  });
});
