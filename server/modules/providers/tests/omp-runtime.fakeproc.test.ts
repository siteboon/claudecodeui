// P9: end-to-end adapter test through the REAL spawnOmp path against a FAKE
// `omp` process (a node script speaking ACP JSON-RPC 2.0 over stdio, put on
// OMP_PATH). No paid omp calls. Run with tsx:
//   ./node_modules/.bin/tsx --tsconfig server/tsconfig.json --test server/modules/providers/tests/omp-runtime.fakeproc.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, mkdirSync, appendFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { AnyRecord, ProviderRuntimeContext } from '@/shared/types.js';

// A minimal ACP agent: answers initialize/session/new/set_config_option, streams
// an assistant chunk + a tool_call/tool_call_update, then sends ONE inbound
// session/request_permission and only answers session/prompt once the client
// responds to it. Records its argv so the test can assert the spawn args.
const FAKE_OMP = `#!/usr/bin/env node
const fs = require('node:fs');
fs.writeFileSync(process.env.OMP_FAKE_ARGV_FILE, process.argv.slice(2).join(' '));
const configPath = process.argv[process.argv.indexOf('--config') + 1];
const autoApprove = /approvalMode:\\s*yolo/.test(fs.readFileSync(configPath, 'utf8'));
// Keep an orphan alive even after its parent's stdio closes, so shutdown tests
// cannot pass just because this fixture has less background work than real omp.
if (process.env.OMP_FAKE_KEEP_ALIVE) setInterval(() => {}, 1000);
// One line per child, so a test can count how many times omp was spawned.
if (process.env.OMP_FAKE_SPAWN_FILE) fs.appendFileSync(process.env.OMP_FAKE_SPAWN_FILE, process.pid + '\\n');
// Real omp writes a session_exit entry when it exits gracefully; record the polite
// signal instead so a test can prove we never send one to a retired child.
if (process.env.OMP_FAKE_SIGTERM_FILE) {
  process.on('SIGTERM', () => fs.appendFileSync(process.env.OMP_FAKE_SIGTERM_FILE, process.pid + '\\n'));
}
const SID = 'fake-sess-1';
const PERM_ID = 'perm-1';
const OPTIONS = [
  { optionId: 'ao', kind: 'allow_once', name: 'Allow once' },
  { optionId: 'aa', kind: 'allow_always', name: 'Always allow' },
  { optionId: 'ro', kind: 'reject_once', name: 'Reject' },
  { optionId: 'ra', kind: 'reject_always', name: 'Always reject' },
];
let promptId = null;
let buf = '';
const send = (o) => process.stdout.write(JSON.stringify(o) + '\\n');
const finishTool = (allowed) => {
  send({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: SID, update: {
    sessionUpdate: 'tool_call_update', toolCallId: 't1',
    status: allowed ? 'completed' : 'failed',
    content: allowed ? 'ran' : 'Tool call denied by user: bash',
  } } });
  if (promptId !== null) send({ jsonrpc: '2.0', id: promptId, result: { stopReason: 'end_turn' } });
};
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buf += chunk;
  let nl;
  while ((nl = buf.indexOf('\\n')) >= 0) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (!line) continue;
    let f; try { f = JSON.parse(line); } catch { continue; }
    // Response to our permission request. VALIDATE it the way real omp does
    // (@112180739): look up the returned optionId → its kind must be an allow
    // kind. Only THEN does the tool run (completed); a wrong shape / non-allow
    // optionId → the tool is denied (failed). This asserts the agent ACTS on our
    // response, catching response-shape regressions the old blind test missed.
    if (f.id === PERM_ID && f.method === undefined) {
      const opt = OPTIONS.find((o) => o.optionId === f?.result?.outcome?.optionId);
      const allowed = f?.result?.outcome?.outcome === 'selected' && opt && opt.kind.startsWith('allow');
      finishTool(allowed);
      continue;
    }
    if (f.method === 'initialize') {
      if (process.env.OMP_FAKE_INITIALIZE_FILE) fs.appendFileSync(process.env.OMP_FAKE_INITIALIZE_FILE, process.pid + '\\n');
      if (process.env.OMP_FAKE_HOLD_INITIALIZE) continue;
      if (process.env.OMP_FAKE_INITIALIZE_ERROR) {
        send({ jsonrpc: '2.0', id: f.id, error: { code: -32603, message: process.env.OMP_FAKE_INITIALIZE_ERROR } });
      } else {
        send({ jsonrpc: '2.0', id: f.id, result: { agentCapabilities: { loadSession: true, promptCapabilities: { image: true } } } });
      }
    } else if (f.method === 'session/new') {
      send({ jsonrpc: '2.0', id: f.id, result: { sessionId: SID, configOptions: [] } });
    } else if (f.method === 'session/prompt') {
      promptId = f.id;
      send({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: SID, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'hi' } } } });
      send({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: SID, update: { sessionUpdate: 'tool_call', toolCallId: 't1', title: 'Bash', rawInput: { command: 'ls' } } } });
      // Tool does NOT run until the permission response validates as an allow.
      if (autoApprove) finishTool(true);
      else send({ jsonrpc: '2.0', id: PERM_ID, method: 'session/request_permission', params: { sessionId: SID, toolName: 'Bash', input: { command: 'ls' }, options: OPTIONS } });
    } else if (f.id !== undefined && f.method !== undefined) {
      send({ jsonrpc: '2.0', id: f.id, result: {} });
    }
  }
});
`;

const waitFor = async (predicate: () => boolean, ms = 8000) => {
  const start = Date.now();
  while (Date.now() - start < ms) {
    if (predicate()) return true;
    await new Promise((r) => setTimeout(r, 15));
  }
  return false;
};

// Runs one turn through the real spawnOmp against the fake omp. In 'default'
// mode it waits for the emitted permission_request and resolves it with `allow`;
// in 'plan' mode the adapter auto-denies synchronously (no UI prompt), so there
// is nothing to wait on. Returns captured messages + the recorded argv.
async function runFakeTurn({ allow = true, permissionMode = 'default' } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'omp-fake-'));
  const fakePath = join(dir, 'omp');
  const argvFile = join(dir, 'argv.txt');
  writeFileSync(fakePath, FAKE_OMP, { mode: 0o755 });

  const prev = { OMP_PATH: process.env.OMP_PATH, HOME: process.env.HOME, OMP_FAKE_ARGV_FILE: process.env.OMP_FAKE_ARGV_FILE };
  process.env.OMP_PATH = fakePath;
  process.env.OMP_FAKE_ARGV_FILE = argvFile;
  process.env.HOME = dir; // isolate the post-turn token-usage jsonl glob

  const { spawnOmp, __closeConnectionsForTest } = await import('@/modules/providers/list/omp/omp-runtime.provider.js');
  const { resolveToolApproval } = await import('@/shared/tool-approval-registry.js');
  const { OmpSessionsProvider } = await import('@/modules/providers/list/omp/omp-sessions.provider.js');

  // Stands in for the IProviderRuntime context the provider registry passes in.
  const ompSessions = new OmpSessionsProvider();
  const context: ProviderRuntimeContext = {
    normalizeMessage: (raw, sid) => ompSessions.normalizeMessage(raw, sid),
    resolveProviderSessionId: (sid) => sid ?? null,
    resolveResumeModel: async () => undefined,
    getProviderModels: async () => ({ OPTIONS: [], DEFAULT: '' }),
    isProviderInstalled: async () => true,
  };

  const captured: AnyRecord[] = [];
  let sessionIdSet = null;
  const writer = { userId: null, setSessionId: (id: string) => { sessionIdSet = id; }, send: (m: AnyRecord) => captured.push(m) };

  try {
    const runPromise = spawnOmp('do it', { cwd: dir, projectPath: dir, permissionMode }, writer, context);
    if (permissionMode === 'default') {
      const gotPrompt = await waitFor(() => captured.some((m) => m.kind === 'permission_request'));
      assert.ok(gotPrompt, 'a permission_request should be emitted');
      resolveToolApproval(captured.find((m) => m.kind === 'permission_request')!.requestId, { allow });
    }
    // plan mode: routePermissionRequest auto-denies synchronously — no prompt to answer.
    await runPromise;
    return { captured, sessionIdSet, argvFile };
  } finally {
    __closeConnectionsForTest();
    for (const [k, v] of Object.entries(prev)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
}

const orderOf = (captured: AnyRecord[]) => captured.map((m: AnyRecord) => m.kind).filter((k: string) =>
  ['session_created', 'stream_delta', 'tool_use', 'permission_request', 'tool_result', 'complete'].includes(k));

test('ALLOW: streamed turn + approval round-trip runs the tool', async () => {
  const { captured, sessionIdSet, argvFile } = await runFakeTurn({ allow: true });

  // argv: `acp --config <overlay>` — and the overlay actually contains the fix.
  const argv = readFileSync(argvFile, 'utf8');
  assert.match(argv, /^acp\b/, 'spawned with the acp subcommand');
  const configPath = argv.match(/--config\s+(\S+)/)?.[1];
  assert.ok(configPath && existsSync(configPath), 'overlay path passed via --config');
  const overlay = readFileSync(configPath, 'utf8');
  assert.match(overlay, /approvalMode:\s*always-ask/, 'overlay forces always-ask');
  for (const tool of ['bash', 'edit', 'delete', 'move']) {
    assert.match(overlay, new RegExp(`${tool}:\\s*allow`), `overlay pre-allows ${tool}'s inner gate`);
  }

  assert.equal(sessionIdSet, 'fake-sess-1');
  assert.equal(captured.find((m) => m.kind === 'session_created')?.newSessionId, 'fake-sess-1');
  // Tool RUNS only after approval → tool_result after permission_request.
  assert.deepEqual(orderOf(captured), ['session_created', 'stream_delta', 'tool_use', 'permission_request', 'tool_result', 'complete']);
  const toolResult = captured.find((m) => m.kind === 'tool_result');
  assert.equal(toolResult?.isError, false, 'approved tool ran, not denied');
  assert.equal(toolResult?.content, 'ran');
  assert.equal(captured.find((m) => m.kind === 'stream_delta')?.content, 'hi');
  assert.equal(captured.filter((m) => m.kind === 'complete').length, 1, 'exactly one complete');
  assert.equal(captured.find((m) => m.kind === 'complete')?.exitCode, 0);
});

test('DENY: rejected approval blocks the tool but still completes', async () => {
  const { captured } = await runFakeTurn({ allow: false });
  // createPermissionDecision(deny) → reject_once optionId → fake marks the tool failed.
  const toolResult = captured.find((m) => m.kind === 'tool_result');
  assert.equal(toolResult?.isError, true, 'denied tool must NOT run');
  assert.match(toolResult?.content ?? '', /denied/i);
  assert.equal(captured.filter((m) => m.kind === 'complete').length, 1, 'a terminal complete still arrives');
});

test('a tampered approval overlay cannot make the next child run tools without approval', async () => {
  const first = await runFakeTurn();
  const configPath = readFileSync(first.argvFile, 'utf8').match(/--config\s+(\S+)/)?.[1];
  assert.ok(configPath);
  writeFileSync(configPath, 'tools:\n  approvalMode: yolo\n');

  const { captured } = await runFakeTurn({ allow: false });
  assert.ok(captured.some((message) => message.kind === 'permission_request'),
    'a new child must still ask after another process rewrites its overlay');
  assert.equal(captured.find((message) => message.kind === 'tool_result')?.isError, true,
    'rejecting the requested permission prevents the tool from running');
});

// A warm child ignores session/load for a session it already holds, so a session
// the user's terminal has appended to since must be resumed on a NEW child —
// otherwise the turn continues from a frozen snapshot and forks the transcript.
test('a session changed on disk by another omp process resumes on a fresh child', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'omp-fake-stale-'));
  const fakePath = join(dir, 'omp');
  const spawnFile = join(dir, 'spawns.txt');
  const sigtermFile = join(dir, 'sigterms.txt');
  writeFileSync(fakePath, FAKE_OMP, { mode: 0o755 });
  writeFileSync(spawnFile, '');
  writeFileSync(sigtermFile, '');

  const prev = {
    OMP_PATH: process.env.OMP_PATH,
    HOME: process.env.HOME,
    OMP_FAKE_ARGV_FILE: process.env.OMP_FAKE_ARGV_FILE,
    OMP_FAKE_SPAWN_FILE: process.env.OMP_FAKE_SPAWN_FILE,
    OMP_FAKE_SIGTERM_FILE: process.env.OMP_FAKE_SIGTERM_FILE,
  };
  process.env.OMP_PATH = fakePath;
  process.env.OMP_FAKE_ARGV_FILE = join(dir, 'argv.txt');
  process.env.OMP_FAKE_SPAWN_FILE = spawnFile;
  process.env.OMP_FAKE_SIGTERM_FILE = sigtermFile;
  process.env.HOME = dir; // the session-file lookup is rooted at $HOME

  const SID = 'fake-sess-1';
  const sessionDir = join(dir, '.omp', 'agent', 'sessions', 'proj');
  mkdirSync(sessionDir, { recursive: true });
  const jsonlPath = join(sessionDir, `2026-08-09T00-00-00-000Z_${SID}.jsonl`);
  writeFileSync(jsonlPath, `${JSON.stringify({ type: 'session', id: SID, cwd: dir })}\n`);

  const { spawnOmp, __closeConnectionsForTest } = await import('@/modules/providers/list/omp/omp-runtime.provider.js');
  const { OmpSessionsProvider } = await import('@/modules/providers/list/omp/omp-sessions.provider.js');
  const ompSessions = new OmpSessionsProvider();
  const context: ProviderRuntimeContext = {
    normalizeMessage: (raw, sid) => ompSessions.normalizeMessage(raw, sid),
    resolveProviderSessionId: (sid) => sid ?? null,
    resolveResumeModel: async () => undefined,
    getProviderModels: async () => ({ OPTIONS: [], DEFAULT: '' }),
    isProviderInstalled: async () => true,
  };
  // bypassPermissions auto-allows the fake's permission request, so a turn needs
  // no UI round-trip and the harness can run several back to back.
  const runTurn = () => spawnOmp(
    'go',
    { cwd: dir, projectPath: dir, sessionId: SID, permissionMode: 'bypassPermissions' },
    { userId: null, setSessionId: () => {}, send: () => {} },
    context,
  );
  const spawnCount = () => readFileSync(spawnFile, 'utf8').trim().split('\n').filter(Boolean).length;

  try {
    await runTurn();
    assert.equal(spawnCount(), 1, 'first turn spawns the child');

    await runTurn();
    assert.equal(spawnCount(), 1, 'an unchanged session reuses the warm child');

    // Stand in for the user's terminal appending to the same session.
    appendFileSync(jsonlPath, `${JSON.stringify({ type: 'message', id: 'x1', parentId: null })}\n`);
    await runTurn();
    assert.equal(spawnCount(), 2, 'a foreign write retires the stale child and respawns');

    await runTurn();
    assert.equal(spawnCount(), 2, 'the fresh child is then reused again');

    // The retired child must be killed HARD. A graceful exit makes omp append a
    // session_exit entry under the head that child held — the abandoned branch —
    // and the next session/load resumes from the file's last entry, which would put
    // the replacement child straight back on the stale branch.
    await new Promise((resolve) => setTimeout(resolve, 1000)); // let a signal land
    assert.equal(readFileSync(sigtermFile, 'utf8'), '', 'a retired child is never asked to exit politely');
  } finally {
    __closeConnectionsForTest();
    for (const [k, v] of Object.entries(prev)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
});

test('PLAN mode: sensitive tool auto-denied client-side with NO UI prompt', async () => {
  const { captured } = await runFakeTurn({ permissionMode: 'plan' });
  // The plan-mode early-return in routePermissionRequest denies WITHOUT prompting.
  assert.equal(captured.filter((m) => m.kind === 'permission_request').length, 0, 'plan mode emits no UI prompt');
  const toolResult = captured.find((m) => m.kind === 'tool_result');
  assert.equal(toolResult?.isError, true, 'plan mode auto-denies the sensitive tool (not run)');
  assert.equal(captured.filter((m) => m.kind === 'complete').length, 1, 'a terminal complete still arrives');
});

test('failed initialize is reaped, retry works, and server exit kills idle and initializing children', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'omp-fake-lifecycle-'));
  const fakePath = join(dir, 'omp');
  const spawnFile = join(dir, 'spawns.txt');
  const initializeFile = join(dir, 'initializes.txt');
  const runtimeUrl = new URL('../list/omp/omp-runtime.provider.ts', import.meta.url).href;
  const root = fileURLToPath(new URL('../../../../', import.meta.url));
  writeFileSync(fakePath, FAKE_OMP, { mode: 0o755 });

  // The server must really exit: invoking the test cleanup helper would not
  // catch a missing process exit hook. Keep all files and credentials isolated.
  const hostScript = `
    import { readFileSync, existsSync, writeFileSync } from 'node:fs';
    import { spawnOmp } from ${JSON.stringify(runtimeUrl)};
    const captured = [];
    const context = {
      normalizeMessage: () => [],
      resolveProviderSessionId: () => null,
      resolveResumeModel: async () => undefined,
      getProviderModels: async () => ({ OPTIONS: [], DEFAULT: '' }),
      isProviderInstalled: async () => true,
    };
    const writer = { userId: null, send: (message) => captured.push(message), setSessionId() {} };
    const pids = (file) => existsSync(file)
      ? readFileSync(file, 'utf8').trim().split(/\\s+/).map(Number).filter((pid) => Number.isSafeInteger(pid) && pid > 0)
      : [];
    // These conditions depend on OS child exit and another process's file write;
    // advancing this process's fake timers cannot advance either event.
    const waitFor = async (predicate) => {
      const deadline = Date.now() + 8000;
      while (Date.now() < deadline) {
        if (predicate()) return true;
        await new Promise((resolve) => setTimeout(resolve, 15));
      }
      return false;
    };
    process.env.OMP_FAKE_INITIALIZE_ERROR = 'fixture initialize failure';
    await spawnOmp('', { cwd: process.env.HOME }, writer, context);
    const failedPid = pids(process.env.OMP_FAKE_SPAWN_FILE)[0];
    const failedInitializeReported = captured.some((message) =>
      message.kind === 'error' && message.content.includes('fixture initialize failure'));
    const failedInitializeExited = Number.isSafeInteger(failedPid) && await waitFor(() => {
      try { process.kill(failedPid, 0); return false; }
      catch (error) { if (error.code === 'ESRCH') return true; throw error; }
    });
    delete process.env.OMP_FAKE_INITIALIZE_ERROR;
    captured.length = 0;
    await spawnOmp('', { cwd: process.env.HOME }, writer, context);
    const retrySucceeded = captured.some((message) => message.kind === 'complete' && message.exitCode === 0)
      && pids(process.env.OMP_FAKE_SPAWN_FILE).length === 2;
    process.env.OMP_FAKE_HOLD_INITIALIZE = '1';
    void spawnOmp('', { cwd: process.env.HOME, permissionMode: 'plan' }, writer, context);
    const initializingStarted = await waitFor(() => pids(process.env.OMP_FAKE_INITIALIZE_FILE).length === 3);
    writeFileSync(1, 'LIFECYCLE_RESULT ' + JSON.stringify({
      failedInitializeReported, failedInitializeExited, retrySucceeded, initializingStarted,
    }) + '\\n');
    process.exit(0);
  `;
  const host = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '--eval', hostScript], {
    cwd: root,
    env: {
      ...process.env,
      HOME: dir,
      DATABASE_PATH: join(dir, 'auth.db'),
      TSX_TSCONFIG_PATH: join(root, 'server/tsconfig.json'),
      OMP_PATH: fakePath,
      OMP_FAKE_ARGV_FILE: join(dir, 'argv.txt'),
      OMP_FAKE_SPAWN_FILE: spawnFile,
      OMP_FAKE_INITIALIZE_FILE: initializeFile,
      OMP_FAKE_KEEP_ALIVE: '1',
      OMP_FAKE_INITIALIZE_ERROR: '',
      OMP_FAKE_HOLD_INITIALIZE: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 30_000,
    killSignal: 'SIGKILL',
  });
  let output = '';
  host.stdout.on('data', (chunk) => { output += chunk; });
  host.stderr.on('data', (chunk) => { output += chunk; });
  const childPids = () => existsSync(spawnFile)
    ? readFileSync(spawnFile, 'utf8').trim().split(/\s+/).map(Number).filter((pid) => Number.isSafeInteger(pid) && pid > 0)
    : [];
  const isRunning = (pid: number) => {
    try {
      process.kill(pid, 0);
      // An exited orphan can briefly remain a zombie until its new parent reaps
      // it. It cannot execute tools and does not count as a surviving child.
      return process.platform !== 'linux'
        || readFileSync(`/proc/${pid}/stat`, 'utf8').match(/\) ([A-Z]) /)?.[1] !== 'Z';
    } catch (error) {
      if (error instanceof Error && 'code' in error && (error.code === 'ESRCH' || error.code === 'ENOENT')) {
        return false;
      }
      throw error;
    }
  };

  try {
    const [exitCode, signal] = await once(host, 'close');
    assert.equal(signal, null, output);
    assert.equal(exitCode, 0, output);
    const resultLine = output.split('\n').find((line) => line.startsWith('LIFECYCLE_RESULT '));
    assert.ok(resultLine, output);
    const result: unknown = JSON.parse(resultLine.slice('LIFECYCLE_RESULT '.length));
    assert.deepEqual(result, {
      failedInitializeReported: true,
      failedInitializeExited: true,
      retrySucceeded: true,
      initializingStarted: true,
    });
    const pids = childPids();
    assert.equal(pids.length, 3);
    assert.equal(await waitFor(() => pids.every((pid) => !isRunning(pid))), true,
      'no omp child may survive the server, including a pending initialize');
  } finally {
    if (host.exitCode === null && host.signalCode === null) {
      host.kill('SIGKILL');
      await once(host, 'close');
    }
    for (const pid of childPids()) {
      if (isRunning(pid)) process.kill(pid, 'SIGKILL');
    }
    rmSync(dir, { recursive: true, force: true });
  }
});
