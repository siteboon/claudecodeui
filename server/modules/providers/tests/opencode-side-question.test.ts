import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import Database from 'better-sqlite3';

import { closeConnection, initializeDatabase, sessionsDb } from '@/modules/database/index.js';
import { opencodeRuntime } from '@/modules/providers/list/opencode/opencode-runtime.provider.js';
import { OpenCodeSessionSynchronizer } from '@/modules/providers/list/opencode/opencode-session-synchronizer.provider.js';
import type { ProviderRuntimeContext, SideQuestionOutcome, SideQuestionRequest } from '@/shared/types.js';
import { SIDE_CONVERSATION_DEVELOPER_INSTRUCTIONS } from '@/shared/utils.js';

/**
 * An opencode side question is `opencode run --session <id> --fork` under a
 * read-only agent passed in `OPENCODE_CONFIG_CONTENT`, and the fork is deleted
 * afterwards. A fake `opencode` on PATH records every invocation's args and
 * env (pattern of `list/opencode/opencode-runtime.provider.test.js`). The
 * synchronizer half runs against a fake `opencode.db` and checks that a
 * side-question fork never becomes a sidebar session.
 */

const PARENT_SESSION = 'open-parent-1';
const FORK_SESSION = 'open-fork-1';
const QUESTION = 'Which file holds the router?';
const MODEL = 'github-copilot/gpt-5.6-terra';

type Registry = { add(id: string): void; delete(id: string): void; has(id: string): boolean };
type RuntimeSideQuestion = {
  askSideQuestion?: (
    request: SideQuestionRequest,
    sink: { delta(text: string): void },
    context: ProviderRuntimeContext,
  ) => Promise<SideQuestionOutcome>;
};

const runtime = opencodeRuntime as unknown as RuntimeSideQuestion;

/** The fork registry is a new module; a missing one is an assertion, not an import crash. */
async function loadForkRegistry(): Promise<Registry | null> {
  try {
    const module = await import('@/modules/providers/list/opencode/opencode-side-question-forks.js') as { opencodeSideQuestionForks?: Registry };
    return module.opencodeSideQuestionForks ?? null;
  } catch {
    return null;
  }
}

async function requireForkRegistry(): Promise<Registry> {
  const registry = await loadForkRegistry();
  assert.ok(registry, 'opencodeSideQuestionForks is missing (contract-server: opencode-side-question-forks.ts)');
  return registry;
}

const findEnvKey = (name: string) =>
  Object.keys(process.env).find((key) => key.toLowerCase() === name.toLowerCase()) || name;

type Invocation = { args: string[]; configContent: string | null; permission: string | null };

/**
 * `run` answers as `FAKE_OPENCODE_MODE` says, with the fork's id on every
 * event (the shape `opencode run --format json` prints, text nested in
 * `part`); `session delete` only records. Each invocation is one JSON line in
 * `OPENCODE_SIDE_CAPTURE`.
 */
async function createFakeOpenCode(binDir: string): Promise<void> {
  await writeFile(path.join(binDir, 'opencode.js'), `
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.OPENCODE_SIDE_CAPTURE, JSON.stringify({
  args,
  configContent: process.env.OPENCODE_CONFIG_CONTENT ?? null,
  permission: process.env.OPENCODE_PERMISSION ?? null,
}) + '\\n');
const dir = require('node:path').dirname(process.env.OPENCODE_SIDE_CAPTURE);
if (args[0] === 'session') {
  // A delete that takes a moment, so a fork id dropped before it finished shows.
  setTimeout(() => {
    fs.writeFileSync(require('node:path').join(dir, 'delete-finished'), args.join(' '));
    process.exit(0);
  }, 400);
  return;
}
if (args[0] !== 'run') process.exit(0);
fs.writeFileSync(require('node:path').join(dir, 'run.pid'), String(process.pid));

const FORK = ${JSON.stringify(FORK_SESSION)};
const text = (value) => console.log(JSON.stringify({
  type: 'text', timestamp: Date.now(), sessionID: FORK,
  part: { id: 'prt-' + value, sessionID: FORK, messageID: 'msg-1', type: 'text', text: value },
}));
const mode = process.env.FAKE_OPENCODE_MODE || 'finish';
if (mode === 'hang') {
  text('Partial');
  setInterval(() => {}, 1000);
  setTimeout(() => process.exit(0), 15000);
} else if (mode === 'error') {
  text('Partial');
  console.log(JSON.stringify({ type: 'error', timestamp: Date.now(), sessionID: FORK, error: { name: 'UnknownError', data: { message: 'provider exploded' } } }));
  process.exit(1);
} else {
  text('Hel');
  text('lo');
  console.log(JSON.stringify({ type: 'step_finish', timestamp: Date.now(), sessionID: FORK, part: { type: 'step-finish', reason: 'stop' } }));
}
`, 'utf8');

  if (process.platform === 'win32') {
    await writeFile(path.join(binDir, 'opencode.cmd'), '@echo off\r\nnode "%~dp0opencode.js" %*\r\n', 'utf8');
    return;
  }
  const commandPath = path.join(binDir, 'opencode');
  await writeFile(commandPath, '#!/bin/sh\nexec node "$(dirname "$0")/opencode.js" "$@"\n', 'utf8');
  await chmod(commandPath, 0o755);
}

type FakeRun = { dir: string; invocations: () => Promise<Invocation[]> };

async function withFakeOpenCode(
  env: Record<string, string | undefined>,
  runTest: (fake: FakeRun) => Promise<void>,
): Promise<void> {
  assert.equal(typeof runtime.askSideQuestion, 'function', 'opencodeRuntime.askSideQuestion is missing (contract-server)');

  const dir = await mkdtemp(path.join(os.tmpdir(), 'opencode-side-question-'));
  const capture = path.join(dir, 'invocations.jsonl');
  await writeFile(capture, '', 'utf8');
  await createFakeOpenCode(dir);

  const pathKey = findEnvKey('PATH');
  const pathExtKey = findEnvKey('PATHEXT');
  const overrides: Record<string, string | undefined> = {
    [pathKey]: `${dir}${path.delimiter}${process.env[pathKey] || ''}`,
    OPENCODE_SIDE_CAPTURE: capture,
    FAKE_OPENCODE_MODE: undefined,
    OPENCODE_CONFIG_CONTENT: undefined,
    OPENCODE_PERMISSION: undefined,
    ...env,
  };
  if (process.platform === 'win32') {
    overrides[pathExtKey] = `.COM;.EXE;.BAT;.CMD;${process.env[pathExtKey] || ''}`;
  }
  const previous: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(overrides)) {
    previous[key] = process.env[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  const invocations = async () => (await readFile(capture, 'utf8'))
    .split('\n').filter((line) => line.trim()).map((line) => JSON.parse(line) as Invocation);

  try {
    await runTest({ dir, invocations });
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    await rm(dir, { recursive: true, force: true });
  }
}

const context = {} as ProviderRuntimeContext;

const request = (projectPath: string, signal = new AbortController().signal): SideQuestionRequest => ({
  appSessionId: 'app-opencode-session',
  providerSessionId: PARENT_SESSION,
  projectPath,
  question: QUESTION,
  model: MODEL,
  signal,
});

async function ask(req: SideQuestionRequest): Promise<{ outcome: SideQuestionOutcome; deltas: string[] }> {
  const deltas: string[] = [];
  const outcome = await runtime.askSideQuestion!(req, { delta: (text) => { deltas.push(text); } }, context);
  return { outcome, deltas };
}

const settle = () => new Promise((resolve) => { setTimeout(resolve, 25); });

async function waitFor(condition: () => boolean | Promise<boolean>, message: string): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (await condition()) {
      return;
    }
    await settle();
  }
  assert.fail(message);
}

const valueAfter = (args: string[], flag: string) => {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
};
const runInvocation = (all: Invocation[]) => all.find((entry) => entry.args[0] === 'run');
async function deleteFinished(dir: string): Promise<boolean> {
  try {
    return (await readFile(path.join(dir, 'delete-finished'), 'utf8')) === `session delete ${FORK_SESSION}`;
  } catch {
    return false;
  }
}

/** The delete has started; while the fake still runs it, the fork id must stay registered. */
async function assertRegisteredUntilDeleteFinished(dir: string, registry: Registry, invocations: FakeRun['invocations']): Promise<void> {
  await waitFor(async () => (await invocations()).some(isForkDelete), 'opencode session delete <forkId> ran');
  if (!(await deleteFinished(dir))) {
    assert.equal(registry.has(FORK_SESSION), true, 'the fork id stays registered while the delete runs');
  }
  await waitFor(() => deleteFinished(dir), 'the delete finished');
  await waitFor(() => !registry.has(FORK_SESSION), 'the fork id leaves the registry after the delete');
}

const isForkDelete = (entry: Invocation) =>
  entry.args[0] === 'session' && entry.args[1] === 'delete' && entry.args[2] === FORK_SESSION;

test('the run forks the session under the sidequestion agent', { concurrency: false }, async () => {
  await withFakeOpenCode({}, async ({ dir, invocations }) => {
    await ask(request(dir));
    const run = runInvocation(await invocations());
    assert.ok(run, 'opencode run was invoked');

    assert.deepEqual(run.args.slice(0, 3), ['run', '--format', 'json']);
    assert.equal(valueAfter(run.args, '--dir'), dir);
    assert.equal(valueAfter(run.args, '--session'), PARENT_SESSION);
    assert.ok(run.args.includes('--fork'), '--fork is passed');
    assert.equal(valueAfter(run.args, '--agent'), 'sidequestion');
    assert.equal(valueAfter(run.args, '--model'), MODEL);
    assert.equal(run.args[run.args.length - 1], QUESTION, 'the question is the prompt');
  });
});

test('the sidequestion agent allows read tools only and carries the side instructions', { concurrency: false }, async () => {
  await withFakeOpenCode({}, async ({ dir, invocations }) => {
    await ask(request(dir));
    const run = runInvocation(await invocations());
    assert.ok(run?.configContent, 'OPENCODE_CONFIG_CONTENT is set');

    const agent = JSON.parse(run.configContent).agent?.sidequestion;
    assert.ok(agent, 'agent.sidequestion is defined');
    assert.equal(agent.mode, 'primary');
    assert.equal(agent.prompt, SIDE_CONVERSATION_DEVELOPER_INSTRUCTIONS);
    assert.equal(typeof agent.description, 'string');

    const permission = agent.permission;
    // Rules are ordered and the last match wins, so the wildcard comes first.
    assert.equal(Object.keys(permission)[0], '*');
    assert.equal(permission['*'], 'deny');
    for (const tool of ['grep', 'glob', 'list']) {
      assert.equal(permission[tool], 'allow', `${tool} is allowed`);
    }
    // read keeps opencode's own protection of environment files.
    assert.equal(typeof permission.read, 'object', 'read is a pattern map, not a plain allow');
    assert.equal(permission.read['*'], 'allow');
    assert.equal(permission.read['*.env'], 'deny');
    assert.equal(permission.read['*.env.*'], 'deny');
    for (const tool of ['edit', 'bash', 'task', 'webfetch', 'external_directory']) {
      assert.equal(permission[tool], 'deny', `${tool} is denied explicitly`);
    }
  });
});

test('a user OPENCODE_CONFIG_CONTENT is merged, ours wins, and the sidequestion permission is exactly ours', { concurrency: false }, async () => {
  const userConfig = {
    model: 'user/own-model',
    agent: {
      mine: { mode: 'subagent', prompt: 'user agent' },
      // 'github_*' is a key ours does not set: merged in, it would land after
      // '*': 'deny' and, last match winning, let the user's MCP tool run.
      sidequestion: { prompt: 'user prompt', permission: { bash: 'allow', 'github_*': 'allow' } },
    },
  };
  await withFakeOpenCode({}, async ({ dir, invocations }) => {
    // Ours alone first, as the reference for the exact permission map.
    await ask(request(dir));
    const plain = runInvocation(await invocations());
    assert.ok(plain?.configContent, 'OPENCODE_CONFIG_CONTENT is set without a user config');
    const ourPermission = JSON.parse(plain.configContent).agent?.sidequestion?.permission;

    process.env.OPENCODE_CONFIG_CONTENT = JSON.stringify(userConfig);
    const before = (await invocations()).length;
    await ask(request(dir));
    const run = runInvocation((await invocations()).slice(before));
    assert.ok(run?.configContent, 'OPENCODE_CONFIG_CONTENT is set');

    const config = JSON.parse(run.configContent);
    assert.equal(config.model, 'user/own-model', 'the user\'s own keys stay');
    assert.deepEqual(config.agent?.mine, userConfig.agent.mine, 'the user\'s own agents stay');
    assert.equal(config.agent?.sidequestion?.prompt, SIDE_CONVERSATION_DEVELOPER_INSTRUCTIONS);
    assert.equal(config.agent?.sidequestion?.permission?.bash, 'deny');
    assert.equal('github_*' in (config.agent?.sidequestion?.permission ?? {}), false, 'no user permission key survives');
    assert.deepEqual(config.agent?.sidequestion?.permission, ourPermission, 'the permission map is exactly ours');
    assert.deepEqual(Object.keys(config.agent?.sidequestion?.permission ?? {}), Object.keys(ourPermission ?? {}), 'in our order');
  });
});

test('OPENCODE_PERMISSION is not passed on to the run', { concurrency: false }, async () => {
  await withFakeOpenCode({ OPENCODE_PERMISSION: JSON.stringify({ edit: 'allow' }) }, async ({ dir, invocations }) => {
    await ask(request(dir));
    const run = runInvocation(await invocations());
    assert.ok(run, 'opencode run was invoked');
    assert.equal(run.permission, null);
  });
});

test('text streams to the sink, the outcome is the whole text, and the fork is deleted', { concurrency: false }, async () => {
  const registry = await loadForkRegistry();
  await withFakeOpenCode({}, async ({ dir, invocations }) => {
    const { outcome, deltas } = await ask(request(dir));
    assert.deepEqual(deltas, ['Hel', 'lo']);
    assert.deepEqual(outcome, { status: 'done', answer: 'Hello' });

    assert.ok(registry, 'opencodeSideQuestionForks is missing (contract-server)');
    await assertRegisteredUntilDeleteFinished(dir, registry, invocations);
  });
});

test('an error from the run is an error outcome and the fork is deleted', { concurrency: false }, async () => {
  await withFakeOpenCode({ FAKE_OPENCODE_MODE: 'error' }, async ({ dir, invocations }) => {
    const { outcome } = await ask(request(dir));
    assert.equal(outcome.status, 'error');
    await waitFor(async () => (await invocations()).some(isForkDelete), 'opencode session delete <forkId> ran on error');
  });
});

test('an abort kills the run, is an error outcome, and deletes the fork registered while it ran', { concurrency: false }, async () => {
  const registry = await requireForkRegistry();
  await withFakeOpenCode({ FAKE_OPENCODE_MODE: 'hang' }, async ({ dir, invocations }) => {
    const controller = new AbortController();
    const deltas: string[] = [];
    const pending = runtime.askSideQuestion!(request(dir, controller.signal), { delta: (text) => { deltas.push(text); } }, context);

    await waitFor(() => deltas.length > 0, 'the run streamed before the abort');
    assert.equal(registry.has(FORK_SESSION), true, 'the fork id is registered as soon as it is read');

    const pid = Number(await readFile(path.join(dir, 'run.pid'), 'utf8'));

    controller.abort();
    const outcome = await pending;
    assert.equal(outcome.status, 'error');

    let alive = true;
    for (let attempt = 0; attempt < 80 && alive; attempt += 1) {
      try { process.kill(pid, 0); await settle(); } catch { alive = false; }
    }
    assert.equal(alive, false, 'the opencode run child is gone after the abort');

    await assertRegisteredUntilDeleteFinished(dir, registry, invocations);
  });
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
  const registry = await requireForkRegistry();
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
  const registry = await requireForkRegistry();
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
