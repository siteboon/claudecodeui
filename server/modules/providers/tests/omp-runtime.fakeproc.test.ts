// P9: end-to-end adapter test through the REAL spawnOmp path against a FAKE
// `omp` process (a node script speaking ACP JSON-RPC 2.0 over stdio, put on
// OMP_PATH). No paid omp calls. Run with tsx:
//   ./node_modules/.bin/tsx --tsconfig server/tsconfig.json --test server/modules/providers/list/omp/omp-runtime.fakeproc.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, mkdirSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { AnyRecord, ProviderRuntimeContext } from '@/shared/types.js';

// A minimal ACP agent: answers initialize/session/new/set_config_option, streams
// an assistant chunk + a tool_call/tool_call_update, then sends ONE inbound
// session/request_permission and only answers session/prompt once the client
// responds to it. Records its argv so the test can assert the spawn args.
const FAKE_OMP = `#!/usr/bin/env node
const fs = require('node:fs');
fs.writeFileSync(process.env.OMP_FAKE_ARGV_FILE, process.argv.slice(2).join(' '));
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
      send({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: SID, update: {
        sessionUpdate: 'tool_call_update', toolCallId: 't1',
        status: allowed ? 'completed' : 'failed',
        content: allowed ? 'ran' : 'Tool call denied by user: bash',
      } } });
      if (promptId !== null) send({ jsonrpc: '2.0', id: promptId, result: { stopReason: 'end_turn' } });
      continue;
    }
    if (f.method === 'initialize') {
      send({ jsonrpc: '2.0', id: f.id, result: { agentCapabilities: { loadSession: true, promptCapabilities: { image: true } } } });
    } else if (f.method === 'session/new') {
      send({ jsonrpc: '2.0', id: f.id, result: { sessionId: SID, configOptions: [] } });
    } else if (f.method === 'session/prompt') {
      promptId = f.id;
      send({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: SID, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'hi' } } } });
      send({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: SID, update: { sessionUpdate: 'tool_call', toolCallId: 't1', title: 'Bash', rawInput: { command: 'ls' } } } });
      // Tool does NOT run until the permission response validates as an allow.
      send({ jsonrpc: '2.0', id: PERM_ID, method: 'session/request_permission', params: { sessionId: SID, toolName: 'Bash', input: { command: 'ls' }, options: OPTIONS } });
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
