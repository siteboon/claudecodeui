// Covers the omp runtime adapter end to end against a fake ACP child: session
// multiplexing (two runs sharing one per-cwd `omp acp` connection must not
// cross-talk), the approval round-trip in every permission mode, the delegated
// filesystem guard, abort, and resume.
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { sessionsDb } from '@/modules/database/index.js';
import { spawnOmp, abortOmpSession, __setConnectionFactoryForTest, writeFileNoFollow, approvalProfileFor, APPROVAL_PROFILES } from '@/modules/providers/list/omp/omp-runtime.provider.js';
import type { OmpConnection } from '@/modules/providers/list/omp/omp-runtime.provider.js';
import { OmpSessionsProvider } from '@/modules/providers/list/omp/omp-sessions.provider.js';
import { resolveToolApproval } from '@/shared/tool-approval-registry.js';
import type { AnyRecord, ProviderRuntimeContext } from '@/shared/types.js';

// The provider registry supplies this IProviderRuntime context in production;
// normalizeMessage delegates to the real omp normalizer, as the registry does.
const ompSessions = new OmpSessionsProvider();
const TEST_CONTEXT: ProviderRuntimeContext = {
  normalizeMessage: (raw, sid) => ompSessions.normalizeMessage(raw, sid),
  resolveProviderSessionId: (sid) => sid ?? null,
  resolveResumeModel: async () => undefined,
  getProviderModels: async () => ({ OPTIONS: [], DEFAULT: '' }),
  isProviderInstalled: async () => true,
};

const flush = async (n = 6) => {
  for (let i = 0; i < n; i += 1) {
    await new Promise((r) => setImmediate(r));
  }
};

function makeWriter() {
  const sent: AnyRecord[] = [];
  return {
    sent,
    userId: null,
    setSessionId() {},
    send(msg: AnyRecord) { sent.push(msg); },
  };
}

// One fake connection shared by every run in the same cwd. Hands out distinct
// session ids from session/new, holds session/prompt open until released, and
// captures the connection-level session/update handler installed by the adapter.
// Waits until the run under test has actually queued the request we are about to
// answer, so a slower setup path cannot race the release. Wall-clock, not ticks:
// the run may be waiting on fs work that no number of microtask turns advances.
const waitForPending = async (queue: unknown[], what: string) => {
  const deadline = Date.now() + 10_000;
  while (queue.length === 0 && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 5));
  }
  // Fail loudly: releasing an empty queue leaves the run awaiting forever, and the
  // suite runs with no per-test timeout, so the whole thing would hang instead.
  assert.ok(queue.length > 0, `timed out waiting for a pending ${what}`);
};

function makeFakeConnection() {
  let sessionCounter = 0;
  const releasePrompt: Array<{ resolve: (value: AnyRecord) => void; reject: (error: Error) => void }> = [];
  const releaseLoad: Array<() => void> = [];

  let updateHandlerFn: ((params: AnyRecord) => void) | null = null;
  const requestHandlers = new Map();

  const connection = {
    initializeResult: { agentCapabilities: { loadSession: true } },
    client: {
      request(method: string) {
        if (method === 'session/new') {
          sessionCounter += 1;
          return Promise.resolve({ sessionId: `S${sessionCounter}` });
        }
        if (method === 'session/load') {
          // Held so tests can abort DURING the setup window (before load resolves).
          return new Promise((resolve) => releaseLoad.push(() => resolve({})));
        }
        if (method === 'session/prompt') {
          return new Promise((resolve, reject) => releasePrompt.push({ resolve, reject }));
        }
        return Promise.resolve({});
      },
      notify() {},
      onNotification(method: string, handler: (params: AnyRecord) => void) {
        if (method === 'session/update') {
          updateHandlerFn = handler;
        }
        return () => {};
      },
      registerRequestHandler(method: string, handler: (params: AnyRecord) => unknown) {
        requestHandlers.set(method, handler);
        return () => {};
      },
      isClosed() { return false; },
    },
  } as unknown as OmpConnection;
  connection.ready = Promise.resolve(connection);

  return {
    connection,
    pendingLoads: () => releaseLoad.length,
    fireUpdate: (params: AnyRecord) => updateHandlerFn?.(params),
    firePermission: (params: AnyRecord) => requestHandlers.get('session/request_permission')?.(params),
    fireRequest: (method: string, params: AnyRecord) => requestHandlers.get(method)!(params),
    // Condition-based, not tick-counted: the runtime may await fs work (the
    // on-disk staleness check) before it issues session/load, so releasing on a
    // fixed number of ticks would fire before the request exists and hang the run.
    releaseLoads: async () => {
      await waitForPending(releaseLoad, 'session/load');
      releaseLoad.splice(0).forEach((fn) => fn());
    },
    releaseAllPrompts: async () => {
      await waitForPending(releasePrompt, 'session/prompt');
      releasePrompt.splice(0).forEach(({ resolve }) => resolve({ stopReason: 'end_turn' }));
    },
    // A failing turn (omp died, the 30-minute ceiling) rejects session/prompt,
    // which is the path that has to release any approval still awaiting a user.
    failAllPrompts: async (message = 'omp prompt failed') => {
      await waitForPending(releasePrompt, 'session/prompt');
      releasePrompt.splice(0).forEach(({ reject }) => reject(new Error(message)));
    },
  };
}

const ALLOW_OPTIONS = [
  { kind: 'allow_once', optionId: 'ao' },
  { kind: 'allow_always', optionId: 'aa' },
  { kind: 'reject_once', optionId: 'ro' },
];

test('session/update routes to the owning run only — no cross-talk', async () => {
  const fake = makeFakeConnection();
  __setConnectionFactoryForTest(() => fake.connection);
  try {
    const writerA = makeWriter();
    const writerB = makeWriter();

    // Same cwd → both runs share the one connection.
    const runA = spawnOmp('hi', { cwd: '/multiplex-test', projectPath: '/multiplex-test' }, writerA, TEST_CONTEXT);
    await flush();
    const runB = spawnOmp('hi', { cwd: '/multiplex-test', projectPath: '/multiplex-test' }, writerB, TEST_CONTEXT);
    await flush();

    // Each run announces its OWN native id — B never adopts A's.
    const scA = writerA.sent.find((m) => m.kind === 'session_created');
    const scB = writerB.sent.find((m) => m.kind === 'session_created');
    assert.equal(scA?.newSessionId, 'S1', 'run A session_created should carry S1');
    assert.equal(scB?.newSessionId, 'S2', 'run B session_created should carry its own S2, not S1');

    // An update for S1 reaches ONLY A's writer.
    fake.fireUpdate({
      sessionId: 'S1',
      update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'forA' } },
    });

    const deltasA = writerA.sent.filter((m) => m.kind === 'stream_delta');
    const deltasB = writerB.sent.filter((m) => m.kind === 'stream_delta');
    assert.equal(deltasA.length, 1, 'A should receive exactly the one update addressed to S1');
    assert.equal(deltasA[0].content, 'forA');
    assert.equal(deltasB.length, 0, 'B must receive no update addressed to S1');

    // Let both turns finish so the module state is clean.
    await fake.releaseAllPrompts();
    await Promise.allSettled([runA, runB]);

    assert.equal(writerA.sent.filter((m) => m.kind === 'complete').length, 1);
    assert.equal(writerB.sent.filter((m) => m.kind === 'complete').length, 1);
  } finally {
    __setConnectionFactoryForTest(null);
  }
});

test('default mode: inbound permission request → UI prompt → resolveToolApproval → allow decision', async () => {
  const fake = makeFakeConnection();
  __setConnectionFactoryForTest(() => fake.connection);
  try {
    const writer = makeWriter();
    const run = spawnOmp('do a thing', { cwd: '/appr-default', projectPath: '/appr-default', permissionMode: 'default' }, writer, TEST_CONTEXT);
    await flush();

    // omp asks to run a tool for this run's session (S1).
    const decisionP = fake.firePermission({ sessionId: 'S1', toolName: 'Write', input: { path: 'x' }, options: ALLOW_OPTIONS });
    await flush();

    const pr = writer.sent.find((m) => m.kind === 'permission_request');
    assert.ok(pr, 'a permission_request should be emitted to the UI');
    assert.equal(pr.toolName, 'Write');
    assert.ok(pr.requestId, 'permission_request carries a requestId');

    // User approves through the shared registry (same path as chat.permission-response).
    resolveToolApproval(pr.requestId, { allow: true });
    const decision = await decisionP;
    assert.deepEqual(decision, { outcome: { outcome: 'selected', optionId: 'ao' } });

    await fake.releaseAllPrompts();
    await Promise.allSettled([run]);
  } finally {
    __setConnectionFactoryForTest(null);
  }
});

test('bypassPermissions: inbound permission request auto-allows with NO UI prompt', async () => {
  const fake = makeFakeConnection();
  __setConnectionFactoryForTest(() => fake.connection);
  try {
    const writer = makeWriter();
    const run = spawnOmp('do a thing', { cwd: '/appr-bypass', projectPath: '/appr-bypass', permissionMode: 'bypassPermissions' }, writer, TEST_CONTEXT);
    await flush();

    const decision = await fake.firePermission({ sessionId: 'S1', toolName: 'Write', options: ALLOW_OPTIONS });
    assert.deepEqual(decision, { outcome: { outcome: 'selected', optionId: 'ao' } });
    assert.equal(writer.sent.filter((m) => m.kind === 'permission_request').length, 0, 'bypass must not emit a prompt');

    await fake.releaseAllPrompts();
    await Promise.allSettled([run]);
  } finally {
    __setConnectionFactoryForTest(null);
  }
});

// Starts a run bound to a REAL cwd so the fs delegation handlers register.
async function startRunForFs(fake: ReturnType<typeof makeFakeConnection>, cwd: string, permissionMode = 'default') {
  const writer = makeWriter();
  const run = spawnOmp('go', { cwd, projectPath: cwd, permissionMode }, writer, TEST_CONTEXT);
  await flush();
  return { writer, run };
}

test('fs guard rejects symlink/traversal/absolute escapes (read + write)', async () => {
  const outside = mkdtempSync(join(tmpdir(), 'omp-fs-outside-'));
  writeFileSync(join(outside, 'secret.txt'), 'SECRET');
  const cwd = mkdtempSync(join(tmpdir(), 'omp-fs-cwd-'));
  writeFileSync(join(cwd, 'real.txt'), 'hello');
  symlinkSync(join(outside, 'secret.txt'), join(cwd, 'linkfile')); // file symlink escaping cwd
  symlinkSync(outside, join(cwd, 'linkdir')); // parent-dir symlink escaping cwd

  const fake = makeFakeConnection();
  __setConnectionFactoryForTest(() => fake.connection);
  try {
    const { run } = await startRunForFs(fake, cwd);

    // Positive controls: a real in-cwd file reads back, and a legit in-cwd write
    // succeeds and lands the content (guards against a reject-everything regression).
    assert.deepEqual(await fake.fireRequest('fs/read_text_file', { path: join(cwd, 'real.txt') }), { content: 'hello' });
    assert.equal(await fake.fireRequest('fs/write_text_file', { path: join(cwd, 'created.txt'), content: 'written', sessionId: 'S1' }), null);
    assert.equal(readFileSync(join(cwd, 'created.txt'), 'utf8'), 'written');

    // READ escapes → rejected.
    await assert.rejects(fake.fireRequest('fs/read_text_file', { path: join(cwd, 'linkfile') }), /escape/i, 'symlink read escape');
    await assert.rejects(fake.fireRequest('fs/read_text_file', { path: join(outside, 'secret.txt') }), /escape/i, 'absolute outside read');
    await assert.rejects(fake.fireRequest('fs/read_text_file', { path: join(cwd, '..', '..', 'etc', 'hosts') }), /escape/i, '.. traversal read');

    // WRITE escapes → rejected (file never modified).
    await assert.rejects(fake.fireRequest('fs/write_text_file', { path: join(cwd, 'linkfile'), content: 'x' }), /symlink/i, 'write through file symlink');
    await assert.rejects(fake.fireRequest('fs/write_text_file', { path: join(cwd, 'linkdir', 'pwned.txt'), content: 'x' }), /escape/i, 'write via parent-dir symlink');
    await assert.rejects(fake.fireRequest('fs/write_text_file', { path: join(outside, 'clobber.txt'), content: 'x' }), /escape/i, 'absolute outside write');

    // F1 fail-closed: a valid in-cwd write with an unknown session is rejected.
    await assert.rejects(fake.fireRequest('fs/write_text_file', { path: join(cwd, 'orphan.txt'), content: 'x', sessionId: 'nope' }), /no live session/i, 'unknown session write');

    await fake.releaseAllPrompts();
    await Promise.allSettled([run]);
  } finally {
    __setConnectionFactoryForTest(null);
  }
});

test('fs write rejects non-string content and plan-mode writes', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'omp-fs-plan-'));
  const fake = makeFakeConnection();
  __setConnectionFactoryForTest(() => fake.connection);
  try {
    const { run } = await startRunForFs(fake, cwd, 'plan');

    // non-string content must throw, not truncate to ''.
    await assert.rejects(fake.fireRequest('fs/write_text_file', { path: join(cwd, 'a.txt'), content: 123, sessionId: 'S1' }), /string/i);
    // plan mode is read-only.
    await assert.rejects(fake.fireRequest('fs/write_text_file', { path: join(cwd, 'a.txt'), content: 'ok', sessionId: 'S1' }), /read-only/i);

    await fake.releaseAllPrompts();
    await Promise.allSettled([run]);
  } finally {
    __setConnectionFactoryForTest(null);
  }
});

test('abort during setup runs no turn, and a later resume of the same id completes exactly once', async () => {
  const fake = makeFakeConnection();
  __setConnectionFactoryForTest(() => fake.connection);
  try {
    // Turn 1: resume 'S1', abort while session/load is still pending (setup window).
    const w1 = makeWriter();
    const run1 = spawnOmp('hi', { cwd: '/abort-resume', projectPath: '/abort-resume', sessionId: 'S1', permissionMode: 'default' }, w1, TEST_CONTEXT);
    await flush();
    assert.equal(await abortOmpSession('S1'), true, 'abort finds the pre-registered resume entry');
    await fake.releaseLoads(); // load resolves → SF-1 early-return, no prompt
    await run1;
    assert.equal(w1.sent.filter((m) => m.kind === 'complete').length, 0, 'aborted setup emits no complete (handleChatAbort owns it)');

    // Turn 2: resume the SAME id. Pre-fix, the leaked abortedSessionIds entry made
    // wasAborted true here and SUPPRESSED this complete — now it completes once.
    const w2 = makeWriter();
    const run2 = spawnOmp('hi', { cwd: '/abort-resume', projectPath: '/abort-resume', sessionId: 'S1', permissionMode: 'default' }, w2, TEST_CONTEXT);
    await flush();
    await fake.releaseLoads();
    await flush();
    await fake.releaseAllPrompts();
    await run2;
    assert.equal(w2.sent.filter((m) => m.kind === 'complete').length, 1, 'resumed turn completes exactly once');
    assert.equal(w2.sent.find((m) => m.kind === 'complete')?.exitCode, 0);
  } finally {
    __setConnectionFactoryForTest(null);
  }
});

test('resume via session/load streams and completes normally', async () => {
  const fake = makeFakeConnection();
  __setConnectionFactoryForTest(() => fake.connection);
  try {
    const w = makeWriter();
    const run = spawnOmp('hi', { cwd: '/resume', projectPath: '/resume', sessionId: 'S9', permissionMode: 'default' }, w, TEST_CONTEXT);
    await flush();
    await fake.releaseLoads();
    await flush(); // acceptingUpdates now true; prompt pending
    fake.fireUpdate({ sessionId: 'S9', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'resumed' } } });
    await fake.releaseAllPrompts();
    await run;

    assert.ok(w.sent.some((m) => m.kind === 'stream_delta' && m.content === 'resumed'), 'resumed session streams');
    assert.equal(w.sent.filter((m) => m.kind === 'complete').length, 1, 'resume completes once');
    assert.equal(w.sent.filter((m) => m.kind === 'session_created').length, 0, 'resume does not re-announce session_created');
  } finally {
    __setConnectionFactoryForTest(null);
  }
});

test('a concurrent resume cannot replace the active native session owner', async () => {
  const fake = makeFakeConnection();
  const mappedContext = { ...TEST_CONTEXT, resolveProviderSessionId: () => 'S1' };
  __setConnectionFactoryForTest(() => fake.connection);
  try {
    const firstWriter = makeWriter();
    const firstRun = spawnOmp(
      'first',
      { cwd: '/concurrent-resume', projectPath: '/concurrent-resume', sessionId: 'APP-1', permissionMode: 'default' },
      firstWriter,
      mappedContext,
    );
    await fake.releaseLoads();
    await flush(); // first prompt is pending and owns S1

    const secondWriter = makeWriter();
    let secondFinished = false;
    const secondRun = spawnOmp(
      'second',
      { cwd: '/concurrent-resume', projectPath: '/concurrent-resume', sessionId: 'APP-2', permissionMode: 'default' },
      secondWriter,
      mappedContext,
    ).then(() => {
      secondFinished = true;
    });

    const deadline = Date.now() + 10_000;
    while (!secondFinished && fake.pendingLoads() === 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 5));
    }
    assert.ok(secondFinished || fake.pendingLoads() > 0,
      'timed out waiting for duplicate resume to finish or start session/load');

    // Let the pre-fix implementation reach its prompt too, so the assertions fail
    // without leaving either fake run pending.
    const secondStartedLoad = fake.pendingLoads() > 0;
    if (secondStartedLoad) {
      await fake.releaseLoads();
      await flush();
    }

    fake.fireUpdate({
      sessionId: 'S1',
      update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'first-owner' } },
    });
    const abortReachedFirst = await abortOmpSession('APP-1');
    await fake.releaseAllPrompts();
    await Promise.all([firstRun, secondRun]);

    assert.equal(secondStartedLoad, false, 'duplicate resume must fail before session/load');
    assert.ok(secondWriter.sent.some((m) => m.kind === 'error' && /already has a run in progress/i.test(m.content)),
      'duplicate resume reports the existing active run');
    assert.equal(secondWriter.sent.find((m) => m.kind === 'complete')?.exitCode, 1);
    assert.ok(firstWriter.sent.some((m) => m.kind === 'stream_delta' && m.content === 'first-owner'),
      'updates remain routed to the first run');
    assert.equal(secondWriter.sent.some((m) => m.kind === 'stream_delta'), false,
      'the duplicate never receives the first run updates');
    assert.equal(abortReachedFirst, true, 'abort still finds the first run');
    assert.equal(firstWriter.sent.some((m) => m.kind === 'complete'), false,
      'the first run observes the abort instead of completing normally');
  } finally {
    __setConnectionFactoryForTest(null);
  }
});

// The delegated-write guard must never follow a symlink out of the workspace. The
// `noFollow = 0` cases emulate Windows, where O_NOFOLLOW does not exist and the
// descriptor has to be verified against the path instead.
test('writeFileNoFollow refuses symlinks and survives a mid-write swap', async () => {
  const { mkdtempSync, writeFileSync, readFileSync, symlinkSync, unlinkSync } = await import('node:fs');
  const dir = mkdtempSync(join(tmpdir(), 'omp-nofollow-'));

  // Plain regular file: writes normally, both with and without the flag.
  const plain = join(dir, 'plain.txt');
  writeFileSync(plain, 'old-and-longer');
  await writeFileNoFollow(plain, 'new');
  assert.equal(readFileSync(plain, 'utf8'), 'new', 'truncates then writes');
  await writeFileNoFollow(plain, 'flagless', 0);
  assert.equal(readFileSync(plain, 'utf8'), 'flagless', 'same result on the flagless path');

  // A symlinked target is refused, and its victim is left untouched.
  for (const noFollow of [undefined, 0]) {
    const victim = join(dir, `victim-${String(noFollow)}.txt`);
    const link = join(dir, `link-${String(noFollow)}.txt`);
    writeFileSync(victim, 'SECRET');
    symlinkSync(victim, link);
    await assert.rejects(
      () => (noFollow === undefined ? writeFileNoFollow(link, 'PWNED') : writeFileNoFollow(link, 'PWNED', 0)),
      /symlink/,
      `symlink refused (noFollow=${String(noFollow)})`,
    );
    assert.equal(readFileSync(victim, 'utf8'), 'SECRET', 'victim untouched');
  }

  // NOTE: the case the identity comparison exists for — the path being a symlink
  // at open() and swapped for an innocent regular file before the check — cannot be
  // driven deterministically from here (whether the swap lands before or after
  // open() is a real race), so it is deliberately not timing-tested. The flagless
  // symlink case above covers the same comparison: a symlink's lstat inode never
  // matches the inode of the file the descriptor actually opened.
});

// omp gates some tools internally, where only a TTY can answer; headless that gate
// fails as "Tool call denied by user: <tool>". Which tools are pre-allowed there
// therefore depends on the run's permission mode, and getting it wrong silently
// breaks a tool (this is exactly how `eval` broke) or silently widens plan mode.
test('a failed turn cancels an approval registered under the app id', async () => {
  const fake = makeFakeConnection();
  __setConnectionFactoryForTest(() => fake.connection);
  try {
    const writer = makeWriter();
    // Chat-created run: the caller hands the APP id, omp announces its own (S1),
    // so the two ids differ — which is the only case this bug appeared in.
    const context: ProviderRuntimeContext = { ...TEST_CONTEXT, resolveProviderSessionId: () => null };
    const run = spawnOmp(
      'do a thing',
      { cwd: '/appr-fail', projectPath: '/appr-fail', sessionId: 'APP-9', permissionMode: 'default' },
      writer,
      context,
    );
    await flush();

    const decisionP = fake.firePermission({
      sessionId: 'S1', toolName: 'Write', input: { path: 'x' }, options: ALLOW_OPTIONS,
    });
    await flush();

    const prompt = writer.sent.find((m) => m.kind === 'permission_request');
    assert.equal(prompt?.sessionId, 'APP-9',
      'the prompt is labelled with the app id, so the registry entry is keyed by it too');

    // The turn now fails while the user has not answered.
    await fake.failAllPrompts();
    await Promise.allSettled([run]);

    // Raced, not awaited bare: before the fix the lookup used omp's native id,
    // matched nothing, and this promise never settled — which would hang the
    // whole suite rather than fail one test.
    const settled = await Promise.race([
      decisionP,
      new Promise((resolve) => setTimeout(() => resolve('NEVER SETTLED'), 2_000)),
    ]);
    assert.deepEqual(settled, { outcome: { outcome: 'cancelled' } },
      'a failed turn must release the awaiting ACP request handler');
  } finally {
    __setConnectionFactoryForTest(null);
  }
});

test('approval profile follows the permission mode', () => {
  // bypassPermissions deliberately shares the gated (always-ask) profile rather
  // than omp's `yolo`: yolo auto-approves even omp's "override" tools (rm -rf /,
  // dd of=/dev/, curl|bash), and bypass can be a user's DEFAULT mode because it is
  // derived from their `approvalMode: yolo` config. routePermissionRequest
  // auto-allows the bypass run instead, with no prompt and the backstop intact.
  assert.equal(approvalProfileFor('bypassPermissions'), 'gated');
  assert.equal(approvalProfileFor('default'), 'gated');
  assert.equal(approvalProfileFor('plan'), 'plan');
  assert.equal(approvalProfileFor('something-unknown'), 'gated', 'unknown modes stay gated');

  // No profile may hand omp `yolo` — that is what drops the backstop.
  for (const [name, yml] of Object.entries(APPROVAL_PROFILES)) {
    assert.match(yml, /approvalMode: always-ask/, `${name} must gate through omp`);
    assert.ok(!yml.includes('yolo'), `${name} must not use omp yolo`);
  }

  // default: every tool omp gates internally must be pre-allowed. omp emits no ACP
  // request for these, so without an entry each fails headlessly as "Tool call
  // denied by user: <tool>" — how the eval and write bugs both reached a user.
  for (const tool of ['write', 'eval', 'ast_edit', 'memory_edit', 'manage_skill', 'browser', 'task']) {
    assert.match(APPROVAL_PROFILES.gated, new RegExp(`\\n    ${tool}: allow\\n`), `${tool} must be pre-allowed`);
    // …and withheld from plan: omp never asks about them, so an entry would let
    // them run unprompted and plan would stop being read-only.
    assert.ok(!APPROVAL_PROFILES.plan.includes(`${tool}: allow`), `plan must not pre-allow ${tool}`);
  }

  // The ACP-gated four stay in BOTH: `allow` only satisfies omp's inner gate, and
  // our own routePermissionRequest still decides (auto-deny in plan).
  for (const tool of ['bash', 'edit', 'delete', 'move']) {
    assert.match(APPROVAL_PROFILES.plan, new RegExp(`\\n    ${tool}: allow\\n`), `${tool} must stay gated-but-allowed in plan`);
    assert.match(APPROVAL_PROFILES.gated, new RegExp(`\\n    ${tool}: allow\\n`));
  }
});

// Callers hand the runtime the stable app session id, never omp's own. These two
// cover the translation in both directions: without it a resumed chat silently
// starts a blank session (load/fork reject an id omp never issued) and an abort
// keyed by the app id never finds the run it is meant to stop.
function recordingFake() {
  const fake = makeFakeConnection();
  const calls: Array<{ method: string; params: AnyRecord }> = [];
  const inner = fake.connection.client.request.bind(fake.connection.client);
  fake.connection.client.request = ((method: string, params: AnyRecord) => {
    calls.push({ method, params });
    return inner(method, params);
  }) as typeof fake.connection.client.request;
  return { ...fake, calls };
}

test('a session with no native id yet starts new instead of loading the app id', async () => {
  const fake = recordingFake();
  __setConnectionFactoryForTest(() => fake.connection);
  try {
    const w = makeWriter();
    // A row created by POST /api/providers/sessions: provider_session_id is NULL.
    const context: ProviderRuntimeContext = { ...TEST_CONTEXT, resolveProviderSessionId: () => null };
    const run = spawnOmp('hi', { cwd: '/fresh', projectPath: '/fresh', sessionId: 'APP-1' }, w, context);
    await flush();
    await fake.releaseAllPrompts();
    await run;

    assert.equal(fake.calls.filter((c) => c.method === 'session/load').length, 0,
      'an app id omp never issued must not be sent to session/load');
    assert.equal(fake.calls.filter((c) => c.method === 'session/fork').length, 0);
    assert.equal(fake.calls.filter((c) => c.method === 'session/new').length, 1);
    assert.equal(w.sent.find((m) => m.kind === 'session_created')?.newSessionId, 'S1',
      'the client learns omp\u2019s native id from session_created');
  } finally {
    __setConnectionFactoryForTest(null);
  }
});

test('a mapped session resumes with omp\u2019s native id, and abort accepts the app id', async () => {
  const fake = recordingFake();
  __setConnectionFactoryForTest(() => fake.connection);
  try {
    const w = makeWriter();
    // The row maps app id APP-2 to the native id omp announced on the first turn.
    const context: ProviderRuntimeContext = {
      ...TEST_CONTEXT,
      resolveProviderSessionId: (sid) => (sid === 'APP-2' ? 'S9' : null),
    };
    const run = spawnOmp('hi', { cwd: '/mapped', projectPath: '/mapped', sessionId: 'APP-2' }, w, context);
    await flush();
    await fake.releaseLoads();
    await flush();

    const load = fake.calls.find((c) => c.method === 'session/load');
    assert.equal(load?.params?.sessionId, 'S9', 'resume must use the native id, not the app id');

    assert.equal(await abortOmpSession('APP-2'), true,
      'the client aborts with the app id, so it must reach the run keyed by the native id');

    await fake.releaseAllPrompts();
    await run;
  } finally {
    __setConnectionFactoryForTest(null);
  }
});

test('abort finds a new app session while session/new is pending', async () => {
  const fake = recordingFake();
  const request = fake.connection.client.request.bind(fake.connection.client);
  const releaseNew: Array<() => void> = [];
  fake.connection.client.request = ((method: string, params: AnyRecord) => {
    if (method === 'session/new') {
      return new Promise<AnyRecord>((resolve) => {
        releaseNew.push(() => resolve({ sessionId: 'NEW-NATIVE' }));
      });
    }
    return request(method, params);
  }) as typeof fake.connection.client.request;
  __setConnectionFactoryForTest(() => fake.connection);

  try {
    const context: ProviderRuntimeContext = {
      ...TEST_CONTEXT,
      resolveProviderSessionId: () => null,
    };
    const writer = makeWriter();
    const run = spawnOmp(
      'must not run',
      { cwd: '/new-setup-abort', projectPath: '/new-setup-abort', sessionId: 'APP-NEW' },
      writer,
      context,
    );
    await waitForPending(releaseNew, 'session/new');
    assert.equal(await abortOmpSession('APP-NEW'), true);
    releaseNew.splice(0).forEach((release) => release());
    await run;

    assert.equal(
      fake.calls.some((call) => call.method === 'session/prompt'),
      false,
      'an aborted setup must not start a prompt after session/new resolves',
    );
    assert.equal(
      writer.sent.some((message) => message.kind === 'session_created'),
      false,
      'an aborted setup must not announce a session after the terminal completion',
    );
  } finally {
    __setConnectionFactoryForTest(null);
  }
});

test('abort during config resolution cannot fall through to session/prompt', async () => {
  const fake = recordingFake();
  const releaseModel: Array<() => void> = [];
  __setConnectionFactoryForTest(() => fake.connection);

  try {
    const context: ProviderRuntimeContext = {
      ...TEST_CONTEXT,
      resolveProviderSessionId: () => null,
      resolveResumeModel: async () => {
        return new Promise<string>((resolve) => {
          releaseModel.push(() => resolve('configured-model'));
        });
      },
    };
    const run = spawnOmp(
      'must not run',
      { cwd: '/config-abort', projectPath: '/config-abort', sessionId: 'APP-CONFIG' },
      makeWriter(),
      context,
    );
    await waitForPending(releaseModel, 'model resolution');
    assert.equal(await abortOmpSession('APP-CONFIG'), true);
    releaseModel.splice(0).forEach((release) => release());
    await run;

    assert.equal(
      fake.calls.some((call) => call.method === 'session/prompt'),
      false,
      'an abort during config setup must stop before session/prompt',
    );
  } finally {
    __setConnectionFactoryForTest(null);
  }
});

test('a rewritten resume id replaces the stale transcript path before the prompt', async () => {
  const fake = recordingFake();
  const request = fake.connection.client.request.bind(fake.connection.client);
  const rewrittenId = `FORKED-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  fake.connection.client.request = (async (method: string, params: AnyRecord) => {
    if (method === 'session/load') {
      throw new Error('load failed');
    }
    if (method === 'session/fork') {
      return { sessionId: rewrittenId };
    }
    return request(method, params);
  }) as typeof fake.connection.client.request;

  const originalRepoint = sessionsDb.repointSessionToProviderSession;
  const repoints: Array<{
    sessionId: string;
    input: { providerSessionId: string; jsonlPath: string | null };
  }> = [];
  sessionsDb.repointSessionToProviderSession = ((sessionId, input) => {
    repoints.push({ sessionId, input });
  }) as typeof sessionsDb.repointSessionToProviderSession;
  __setConnectionFactoryForTest(() => fake.connection);

  try {
    const context: ProviderRuntimeContext = {
      ...TEST_CONTEXT,
      resolveProviderSessionId: () => 'SOURCE-NATIVE',
    };
    const run = spawnOmp(
      'continue',
      { cwd: '/rewritten', projectPath: '/rewritten', sessionId: 'APP-REWRITTEN' },
      makeWriter(),
      context,
    );
    await fake.releaseAllPrompts();
    await run;

    assert.deepEqual(repoints, [{
      sessionId: 'APP-REWRITTEN',
      input: { providerSessionId: rewrittenId, jsonlPath: null },
    }]);
  } finally {
    sessionsDb.repointSessionToProviderSession = originalRepoint;
    __setConnectionFactoryForTest(null);
  }
});
