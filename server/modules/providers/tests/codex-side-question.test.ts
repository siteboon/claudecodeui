import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { codexAppServer } from '@/modules/providers/list/codex/codex-app-server.client.js';
import { codexRuntime } from '@/modules/providers/list/codex/codex-runtime.provider.js';
import type { ProviderRuntimeContext, SideQuestionOutcome, SideQuestionRequest } from '@/shared/types.js';
import {
  SIDE_CONVERSATION_BOUNDARY_PROMPT,
  SIDE_CONVERSATION_DEVELOPER_INSTRUCTIONS,
} from '@/shared/utils.js';

/**
 * A Codex side question is an ephemeral, read-only `thread/fork` with Codex's
 * own side-conversation instructions, plus one `turn/start` on the fork. These
 * run `codexAppServer.askSideQuestion` against a fake app-server — a node
 * script speaking newline-delimited JSON-RPC that records every line it
 * receives — installed through `codexAppServer.resolveLauncher`, so no real
 * Codex binary ever starts.
 *
 * Shapes follow the protocol generated from Codex 0.156.1
 * (`v2/ThreadForkParams`, `TurnStartParams`, `AgentMessageDeltaNotification`,
 * `TurnCompletedNotification`, `ServerRequest`).
 */

const PARENT_THREAD = 'thread-parent-1';
const FORK_THREAD = 'thread-fork-1';
const TURN_ID = 'turn-1';
const QUESTION = 'Which file holds the router?';

type AskInput = { threadId: string; cwd: string; model: string; question: string; signal: AbortSignal };
type AppServerSideQuestion = {
  resolveLauncher?: () => string;
  askSideQuestion?: (input: AskInput, onDelta: (text: string) => void) => Promise<string>;
};
type RuntimeSideQuestion = {
  askSideQuestion?: (
    request: SideQuestionRequest,
    sink: { delta(text: string): void },
    context: ProviderRuntimeContext,
  ) => Promise<SideQuestionOutcome>;
};

const appServer = codexAppServer as unknown as AppServerSideQuestion;
const runtime = codexRuntime as unknown as RuntimeSideQuestion;

type Mode = 'complete' | 'failed' | 'fork-error' | 'hang' | 'server-request' | 'plugin-list-error'
  | 'initialize-hang' | 'completed-only';

/**
 * The fake app-server. `mode` decides how the turn goes; everything received
 * is appended to `log` as one JSON line, and the pid lands in `pidFile` so the
 * abort test can check the child is gone. A self-destruct keeps a broken
 * implementation from leaving it running.
 */
function fakeAppServerSource(
  mode: Mode,
  log: string,
  pidFile: string,
  mcpServerNames: string[] = [],
  pluginIds: string[] = [],
  appsConfig: Record<string, unknown> = {},
  projectOnlyMcpServerNames: string[] = [],
): string {
  return `
const fs = require('node:fs');
const readline = require('node:readline');
const MODE = ${JSON.stringify(mode)};
const LOG = ${JSON.stringify(log)};
const MCP_SERVER_NAMES = ${JSON.stringify(mcpServerNames)};
const PLUGIN_IDS = ${JSON.stringify(pluginIds)};
const APPS_CONFIG = ${JSON.stringify(appsConfig)};
// Returned only when config/read is called with a cwd, the same way the real
// binary only reads a project's .codex/config.toml when it knows which
// project — this is what the "cwd-aware config/read" tests are checking for.
const PROJECT_ONLY_MCP_SERVER_NAMES = ${JSON.stringify(projectOnlyMcpServerNames)};
fs.writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));
setTimeout(() => process.exit(0), 15000);
const send = (message) => process.stdout.write(JSON.stringify(message) + '\\n');
const notify = (method, params) => send({ jsonrpc: '2.0', method, params });
const delta = (threadId, text) => notify('item/agentMessage/delta', { threadId, turnId: ${JSON.stringify(TURN_ID)}, itemId: 'msg-1', delta: text });
const completedMessage = (threadId, id, text) => notify('item/completed', { threadId, turnId: ${JSON.stringify(TURN_ID)}, item: { type: 'agentMessage', id, text, phase: 'final_answer', memoryCitation: null, delivery: null, questions: null }, completedAtMs: 0 });
const turn = (status, error) => ({ id: ${JSON.stringify(TURN_ID)}, items: [], itemsView: 'full', status, error, startedAt: null, completedAt: null });
const FORK = ${JSON.stringify(FORK_THREAD)};
let serverRequestId = null;

function runTurn() {
  if (MODE === 'hang') {
    delta(FORK, 'Partial');
    setInterval(() => {}, 1000);
    return;
  }
  if (MODE === 'failed') {
    delta(FORK, 'partial ');
    notify('turn/completed', { threadId: FORK, turn: turn('failed', { message: 'model overloaded', codexErrorInfo: null, additionalDetails: null, misalignment: null }) });
    return;
  }
  if (MODE === 'completed-only') {
    // Deltas are optional; item/completed carries the final text either way.
    completedMessage('thread-other', 'msg-other', 'NOT THIS THREAD');
    completedMessage(FORK, 'msg-1', 'The router is in src/router.ts.');
    notify('turn/completed', { threadId: FORK, turn: turn('completed', null) });
    return;
  }
  delta(FORK, 'The router ');
  delta('thread-other', 'NOT THIS THREAD');
  delta(FORK, 'is in ');
  delta(FORK, 'src/router.ts.');
  // As the real binary does: the streamed item completes with its whole text.
  completedMessage(FORK, 'msg-1', 'The router is in src/router.ts.');
  notify('turn/completed', { threadId: FORK, turn: turn('completed', null) });
}

readline.createInterface({ input: process.stdin }).on('line', (line) => {
  if (!line.trim()) return;
  const message = JSON.parse(line);
  fs.appendFileSync(LOG, JSON.stringify(message) + '\\n');

  if (serverRequestId !== null && message.id === serverRequestId && !message.method) {
    // The client answered our server request; only now does turn/start get its reply.
    serverRequestId = null;
    send({ jsonrpc: '2.0', id: message.id, result: { turn: turn('inProgress', null) } });
    notify('turn/started', { threadId: FORK, turn: turn('inProgress', null) });
    runTurn();
    return;
  }

  if (message.method === 'initialize') {
    if (MODE === 'initialize-hang') return;
    send({ jsonrpc: '2.0', id: message.id, result: { userAgent: 'fake-codex/0.156.1' } });
  } else if (message.method === 'config/read') {
    const mcp_servers = {};
    for (const name of MCP_SERVER_NAMES) { mcp_servers[name] = { command: 'node', args: [] }; }
    if (message.params && message.params.cwd) {
      for (const name of PROJECT_ONLY_MCP_SERVER_NAMES) { mcp_servers[name] = { command: 'node', args: [] }; }
    }
    send({ jsonrpc: '2.0', id: message.id, result: { config: { mcp_servers, apps: APPS_CONFIG }, origins: {}, layers: null } });
  } else if (message.method === 'plugin/list') {
    if (MODE === 'plugin-list-error') {
      send({ jsonrpc: '2.0', id: message.id, error: { code: -32600, message: 'plugin/list needs auth' } });
      return;
    }
    const marketplaces = PLUGIN_IDS.length
      ? [{ name: 'fake', path: null, interface: null, plugins: PLUGIN_IDS.map((id) => ({ id })) }]
      : [];
    send({ jsonrpc: '2.0', id: message.id, result: { marketplaces, marketplaceLoadErrors: [], featuredPluginIds: [] } });
  } else if (message.method === 'thread/fork') {
    if (MODE === 'fork-error') {
      send({ jsonrpc: '2.0', id: message.id, error: { code: -32600, message: 'thread not found: ${PARENT_THREAD}' } });
      return;
    }
    send({ jsonrpc: '2.0', id: message.id, result: { thread: { id: FORK, path: null, ephemeral: true }, model: 'gpt-5.6', cwd: '/' } });
  } else if (message.method === 'turn/start') {
    if (MODE === 'server-request') {
      // A server request whose id collides with the pending turn/start id.
      serverRequestId = message.id;
      send({ jsonrpc: '2.0', id: message.id, method: 'item/tool/requestUserInput', params: { threadId: FORK, turnId: ${JSON.stringify(TURN_ID)}, itemId: 'tool-1', questions: [] } });
      return;
    }
    send({ jsonrpc: '2.0', id: message.id, result: { turn: turn('inProgress', null) } });
    notify('turn/started', { threadId: FORK, turn: turn('inProgress', null) });
    runTurn();
  }
});
`;
}

type Fake = { dir: string; log: string; pidFile: string; received: () => Promise<Array<Record<string, any>>> };

async function withFakeAppServer(
  mode: Mode,
  runTest: (fake: Fake) => Promise<void>,
  mcpServerNames: string[] = [],
  pluginIds: string[] = [],
  appsConfig: Record<string, unknown> = {},
  projectOnlyMcpServerNames: string[] = [],
): Promise<void> {
  assert.equal(typeof appServer.resolveLauncher, 'function', 'codexAppServer.resolveLauncher is missing (contract-server: the launcher seam)');
  assert.equal(typeof appServer.askSideQuestion, 'function', 'codexAppServer.askSideQuestion is missing (contract-server)');

  const dir = await mkdtemp(path.join(os.tmpdir(), 'codex-side-question-'));
  const log = path.join(dir, 'received.jsonl');
  const pidFile = path.join(dir, 'pid');
  const script = path.join(dir, 'fake-app-server.cjs');
  await writeFile(
    script,
    fakeAppServerSource(mode, log, pidFile, mcpServerNames, pluginIds, appsConfig, projectOnlyMcpServerNames),
    'utf8',
  );
  await writeFile(log, '', 'utf8');

  const original = appServer.resolveLauncher;
  appServer.resolveLauncher = () => script;
  const received = async () => (await readFile(log, 'utf8'))
    .split('\n').filter((line) => line.trim()).map((line) => JSON.parse(line) as Record<string, any>);

  try {
    await runTest({ dir, log, pidFile, received });
  } finally {
    appServer.resolveLauncher = original;
    await rm(dir, { recursive: true, force: true });
  }
}

const askInput = (overrides: Partial<AskInput> = {}): AskInput => ({
  threadId: PARENT_THREAD,
  cwd: '/work/project',
  model: 'gpt-5.6',
  question: QUESTION,
  signal: new AbortController().signal,
  ...overrides,
});

const settle = () => new Promise((resolve) => { setTimeout(resolve, 25); });

test('the fork is ephemeral, read-only and carries the side-conversation instructions', { concurrency: false }, async () => {
  await withFakeAppServer('complete', async ({ received }) => {
    await appServer.askSideQuestion!(askInput(), () => {});
    const lines = await received();

    assert.deepEqual(
      lines.slice(0, 5).map((line) => line.method).sort(),
      ['config/read', 'initialize', 'initialized', 'plugin/list', 'thread/fork'].sort(),
    );
    const fork = lines.find((line) => line.method === 'thread/fork');
    assert.deepEqual(fork?.params, {
      threadId: PARENT_THREAD,
      cwd: '/work/project',
      model: 'gpt-5.6',
      ephemeral: true,
      sandbox: 'read-only',
      approvalPolicy: 'never',
      developerInstructions: SIDE_CONVERSATION_DEVELOPER_INSTRUCTIONS,
      excludeTurns: true,
      config: {
        mcp_servers: {},
        web_search: 'disabled',
        apps: { _default: { enabled: false } },
        features: { plugins: false },
      },
    });
  });
});

test('the fork disables every MCP server config/read names, by name, instead of replacing the table', { concurrency: false }, async () => {
  // Measured against the real 0.156.1 binary (codex-read-only-tools): a
  // `config` override of `{ mcp_servers: {} }` on `thread/fork` is a no-op —
  // overrides deep-merge, so an empty table leaves every already-configured
  // server untouched and it still starts. Only a per-name `enabled: false`
  // (itself undocumented in the generated protocol types, read back through
  // `config/read`) skips a server's startup outright, with no
  // `mcpServer/startupStatus/updated` notification at all.
  await withFakeAppServer('complete', async ({ received }) => {
    await appServer.askSideQuestion!(askInput(), () => {});
    const fork = (await received()).find((line) => line.method === 'thread/fork');
    assert.deepEqual(fork?.params.config, {
      mcp_servers: { github: { enabled: false }, filesystem: { enabled: false } },
      web_search: 'disabled',
      apps: { _default: { enabled: false } },
      features: { plugins: false },
    });
  }, ['github', 'filesystem']);
});

test('the fork turns web search and apps/connectors off in the same config override', { concurrency: false }, async () => {
  // Measured against the real 0.156.1 binary: `thread/start`'s
  // `config: { web_search: 'disabled' }` is accepted outright, while
  // `{ web_search: 'nope' }` is rejected with "unknown variant `nope`,
  // expected one of `disabled`, `cached`, `indexed`, `live`"; and
  // `config: { apps: { _default: { enabled: false } } }` is accepted, while
  // `{ apps: { _default: { enabled: 'nope' } } }` is rejected with "invalid
  // type: string \"nope\", expected a boolean in `apps._default.enabled`" —
  // both fields are real and the override value lands.
  await withFakeAppServer('complete', async ({ received }) => {
    await appServer.askSideQuestion!(askInput(), () => {});
    const fork = (await received()).find((line) => line.method === 'thread/fork');
    assert.equal(fork?.params.config.web_search, 'disabled');
    assert.deepEqual(fork?.params.config.apps, { _default: { enabled: false } });
  });
});

test('config/read is sent with the side question\'s own working directory as cwd', { concurrency: false }, async () => {
  // Without `cwd`, `config/read` never reads the project layer
  // (`<project>/.codex/config.toml`), so a trusted project's own MCP servers
  // and apps would be invisible to the overrides below and stay on in the
  // fork, where approvalPolicy is 'never'.
  await withFakeAppServer('complete', async ({ received }) => {
    await appServer.askSideQuestion!(askInput(), () => {});
    const configRead = (await received()).find((line) => line.method === 'config/read');
    assert.ok(configRead, 'config/read was sent');
    assert.deepEqual(configRead.params, { cwd: '/work/project' });
  });
});

test('a per-app entry config/read reports is switched off by name, alongside _default', { concurrency: false }, async () => {
  // `app_is_enabled` (codex-rs/connectors/src/app_tool_policy.rs:107 at
  // rust-v0.166.0) prefers a per-app `[apps.<id>]` entry over `_default`, and
  // `AppConfig.enabled` defaults to true. So a user's `github` table with no
  // `enabled` key, or one that explicitly turns itself on, stays enabled in
  // the fork unless each reported app name gets its own `enabled: false` —
  // `_default` alone does not reach it.
  await withFakeAppServer('complete', async ({ received }) => {
    await appServer.askSideQuestion!(askInput(), () => {});
    const fork = (await received()).find((line) => line.method === 'thread/fork');
    assert.deepEqual(fork?.params.config.apps, {
      _default: { enabled: false },
      github: { enabled: false },
      slack: { enabled: false },
    });
  }, [], [], { github: {}, slack: { enabled: true } });
});

test('MCP servers only the project layer defines are switched off too, because config/read carries cwd', { concurrency: false }, async () => {
  // A probe against the real binary showed `config/read {}` omits project
  // entries while `config/read {cwd}` lists them, so a server only
  // `<project>/.codex/config.toml` defines would otherwise never be named
  // here and would stay on in the read-only fork.
  await withFakeAppServer('complete', async ({ received }) => {
    await appServer.askSideQuestion!(askInput(), () => {});
    const fork = (await received()).find((line) => line.method === 'thread/fork');
    assert.deepEqual(fork?.params.config.mcp_servers, {
      github: { enabled: false },
      'project-only-server': { enabled: false },
    });
  }, ['github'], [], {}, ['project-only-server']);
});

test('every plugin/list id is passed as disabledPluginIds on turn/start', { concurrency: false }, async () => {
  // Measured against the real 0.156.1 binary: `turn/start` accepted
  // `disabledPluginIds` populated with real plugin ids from `plugin/list`
  // (which needs no auth offline) and only failed later, on the model call
  // itself (401, no credentials here) — the params themselves are valid.
  await withFakeAppServer('complete', async ({ received }) => {
    await appServer.askSideQuestion!(askInput(), () => {});
    const turnStart = (await received()).find((line) => line.method === 'turn/start');
    assert.deepEqual(turnStart?.params.disabledPluginIds, ['game-studio@openai-api-curated', 'github@openai-api-curated']);
  }, [], ['game-studio@openai-api-curated', 'github@openai-api-curated']);
});

test('the fork switches plugins off with features.plugins, whether or not plugin/list answers', { concurrency: false }, async () => {
  // Probed against the real 0.166.0 binary with a throwaway CODEX_HOME and a
  // local plugin shipping an MCP server and a skill: `disabledPluginIds`
  // alone kept the plugin's tool and skill out of the fork's model request,
  // but the plugin's MCP server process still started in the fork. The
  // app-server README says of that field "Saving this selection does not yet
  // filter plugin capabilities". `config: { features: { plugins: false } }`
  // on the fork started no plugin MCP server, exposed no plugin tool and
  // injected no plugin skill, with or without `disabledPluginIds`, while the
  // parent thread kept all three. It needs no plugin ids, so it also holds
  // when plugin/list fails.
  for (const mode of ['complete', 'plugin-list-error'] as const) {
    await withFakeAppServer(mode, async ({ received }) => {
      await appServer.askSideQuestion!(askInput(), () => {});
      const fork = (await received()).find((line) => line.method === 'thread/fork');
      assert.deepEqual(fork?.params.config.features, { plugins: false }, `features override in ${mode} mode`);
    }, [], ['github@openai-api-curated']);
  }
});

test('a plugin/list that errors offline is treated as no plugins, not a failure', { concurrency: false }, async () => {
  await withFakeAppServer('plugin-list-error', async ({ received }) => {
    const answer = await appServer.askSideQuestion!(askInput(), () => {});
    assert.equal(answer, 'The router is in src/router.ts.');
    const turnStart = (await received()).find((line) => line.method === 'turn/start');
    assert.deepEqual(turnStart?.params.disabledPluginIds, []);
  });
});

test('an empty cwd or model is left out of the fork, and out of config/read too', { concurrency: false }, async () => {
  await withFakeAppServer('complete', async ({ received }) => {
    await appServer.askSideQuestion!(askInput({ cwd: '', model: '' }), () => {});
    const lines = await received();
    const fork = lines.find((line) => line.method === 'thread/fork');
    assert.ok(fork, 'thread/fork was sent');
    assert.equal('cwd' in fork.params, false);
    assert.equal('model' in fork.params, false);
    const configRead = lines.find((line) => line.method === 'config/read');
    assert.ok(configRead, 'config/read was sent');
    assert.equal('cwd' in configRead.params, false);
  });
});

test('the turn starts on the fork\'s thread with the boundary prompt and then the question', { concurrency: false }, async () => {
  await withFakeAppServer('complete', async ({ received }) => {
    await appServer.askSideQuestion!(askInput(), () => {});
    const turnStart = (await received()).find((line) => line.method === 'turn/start');
    assert.ok(turnStart, 'turn/start was sent');
    assert.equal(turnStart.params.threadId, FORK_THREAD);
    assert.deepEqual(turnStart.params.input, [
      { type: 'text', text: SIDE_CONVERSATION_BOUNDARY_PROMPT, text_elements: [] },
      { type: 'text', text: QUESTION, text_elements: [] },
    ]);
  });
});

test('deltas for the fork are forwarded in order and the answer resolves after turn/completed', { concurrency: false }, async () => {
  await withFakeAppServer('complete', async () => {
    const deltas: string[] = [];
    const answer = await appServer.askSideQuestion!(askInput(), (text) => { deltas.push(text); });
    assert.deepEqual(deltas, ['The router ', 'is in ', 'src/router.ts.'], 'another thread\'s delta is not forwarded');
    assert.equal(answer, 'The router is in src/router.ts.');
  });
});

test('an agent message that arrives only as item/completed, with no deltas, is the answer', { concurrency: false }, async () => {
  await withFakeAppServer('completed-only', async () => {
    const deltas: string[] = [];
    const answer = await appServer.askSideQuestion!(askInput(), (text) => { deltas.push(text); });
    assert.equal(answer, 'The router is in src/router.ts.', 'the completed item\'s text, and only this fork\'s');
    assert.deepEqual(deltas, ['The router is in src/router.ts.'], 'forwarded once, like a delta');
  });
});

test('a failed turn rejects with the turn\'s error message', { concurrency: false }, async () => {
  await withFakeAppServer('failed', async () => {
    await assert.rejects(appServer.askSideQuestion!(askInput(), () => {}), /model overloaded/);
  });
});

test('a JSON-RPC error rejects with its message', { concurrency: false }, async () => {
  await withFakeAppServer('fork-error', async () => {
    await assert.rejects(appServer.askSideQuestion!(askInput(), () => {}), /thread not found/);
  });
});

test('an aborted signal kills the child and rejects', { concurrency: false }, async () => {
  await withFakeAppServer('hang', async ({ pidFile }) => {
    const controller = new AbortController();
    let sawDelta = false;
    const pending = appServer.askSideQuestion!(askInput({ signal: controller.signal }), () => { sawDelta = true; });
    for (let attempt = 0; attempt < 200 && !sawDelta; attempt += 1) {
      await settle();
    }
    assert.ok(sawDelta, 'the turn was under way before the abort');
    const pid = Number(await readFile(pidFile, 'utf8'));

    controller.abort();
    await assert.rejects(pending);

    let alive = true;
    for (let attempt = 0; attempt < 80 && alive; attempt += 1) {
      try { process.kill(pid, 0); await settle(); } catch { alive = false; }
    }
    assert.equal(alive, false, 'the app-server child is gone after the abort');
  });
});

test('a dismiss while initialize is still pending kills the child at once, not after the request timeout', { concurrency: false, timeout: 30000 }, async () => {
  await withFakeAppServer('initialize-hang', async ({ pidFile, received }) => {
    const controller = new AbortController();
    const pending = appServer.askSideQuestion!(askInput({ signal: controller.signal }), () => {});
    const outcome = pending.then(() => 'resolved', (error: unknown) => error);
    for (let attempt = 0; attempt < 200 && !(await received()).some((line) => line.method === 'initialize'); attempt += 1) {
      await settle();
    }
    assert.ok((await received()).some((line) => line.method === 'initialize'), 'initialize was sent and left unanswered');
    const pid = Number(await readFile(pidFile, 'utf8'));

    controller.abort();
    const settled = await Promise.race([
      outcome,
      new Promise((resolve) => { setTimeout(() => resolve('still pending 2 s after the abort'), 2000); }),
    ]);
    assert.ok(settled instanceof Error, `the ask rejects right after the abort (got ${String(settled)})`);
    assert.match(settled.message, /aborted/);

    let alive = true;
    for (let attempt = 0; attempt < 80 && alive; attempt += 1) {
      try { process.kill(pid, 0); await settle(); } catch { alive = false; }
    }
    assert.equal(alive, false, 'the app-server child is gone after the abort');
  });
});

test('a server request mid-turn is answered with a JSON-RPC error and does not settle turn/start', { concurrency: false }, async () => {
  await withFakeAppServer('server-request', async ({ received }) => {
    const deltas: string[] = [];
    const answer = await appServer.askSideQuestion!(askInput(), (text) => { deltas.push(text); });

    const lines = await received();
    const turnStart = lines.find((line) => line.method === 'turn/start');
    assert.ok(turnStart, 'turn/start was sent');
    const reply = lines.find((line) => line.id === turnStart.id && !line.method);
    assert.ok(reply, 'the client answered the server request');
    assert.ok(reply.error && typeof reply.error.message === 'string', 'with a JSON-RPC error');
    assert.equal('result' in reply, false);
    assert.equal(answer, 'The router is in src/router.ts.', 'the turn still completes');
    assert.deepEqual(deltas, ['The router ', 'is in ', 'src/router.ts.']);
  });
});

// codexRuntime.askSideQuestion maps a SideQuestionRequest onto the client.
// The client itself is replaced here, so nothing is spawned.

const context = {} as ProviderRuntimeContext;

const request = (overrides: Partial<SideQuestionRequest> = {}): SideQuestionRequest => ({
  appSessionId: 'app-codex-session',
  providerSessionId: PARENT_THREAD,
  projectPath: '/work/project',
  question: QUESTION,
  model: 'gpt-5.6',
  signal: new AbortController().signal,
  ...overrides,
});

async function withStubbedClient(
  stub: NonNullable<AppServerSideQuestion['askSideQuestion']>,
  runTest: () => Promise<void>,
): Promise<void> {
  assert.equal(typeof runtime.askSideQuestion, 'function', 'codexRuntime.askSideQuestion is missing (contract-server)');
  const original = appServer.askSideQuestion;
  appServer.askSideQuestion = stub;
  try {
    await runTest();
  } finally {
    appServer.askSideQuestion = original;
  }
}

test('codexRuntime asks on the session\'s thread, project and model, and streams to the sink', { concurrency: false }, async () => {
  const inputs: AskInput[] = [];
  await withStubbedClient(async (input, onDelta) => {
    inputs.push(input);
    onDelta('Hel');
    onDelta('lo');
    return 'Hello';
  }, async () => {
    const deltas: string[] = [];
    const sideRequest = request();
    const outcome = await runtime.askSideQuestion!(sideRequest, { delta: (text) => { deltas.push(text); } }, context);

    assert.equal(inputs.length, 1);
    assert.equal(inputs[0]?.threadId, PARENT_THREAD);
    assert.equal(inputs[0]?.cwd, '/work/project');
    assert.equal(inputs[0]?.model, 'gpt-5.6');
    assert.equal(inputs[0]?.question, QUESTION);
    assert.equal(inputs[0]?.signal, sideRequest.signal);
    assert.deepEqual(deltas, ['Hel', 'lo']);
    assert.deepEqual(outcome, { status: 'done', answer: 'Hello' });
  });
});

test('codexRuntime without a provider session id is an error outcome and asks nothing', { concurrency: false }, async () => {
  let called = false;
  await withStubbedClient(async () => { called = true; return 'unused'; }, async () => {
    const outcome = await runtime.askSideQuestion!(request({ providerSessionId: null }), { delta: () => {} }, context);
    assert.equal(outcome.status, 'error');
    assert.equal(called, false);
  });
});

test('codexRuntime turns a rejected ask into an error outcome, never a throw', { concurrency: false }, async () => {
  await withStubbedClient(async (_input, onDelta) => {
    onDelta('partial');
    throw new Error('model overloaded');
  }, async () => {
    const outcome = await runtime.askSideQuestion!(request(), { delta: () => {} }, context);
    assert.equal(outcome.status, 'error');
    assert.match(outcome.status === 'error' ? outcome.error : '', /model overloaded/);
  });
});
