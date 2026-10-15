import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import type { NormalizedMessage, ProviderRuntimeContext } from '@/shared/types.js';

/**
 * CLOUDCLI_BG_WAIT_CEILING_MS sets how long a session held open for background
 * work may stay silent before its CLI is let go, and the ceiling the CLI itself
 * is started with. The runtime reads it once at load, so this file sets it
 * before importing the runtime.
 */

const CONFIGURED_CEILING_MS = 2 * 60 * 1000;
const DEFAULT_CEILING_MS = 30 * 60 * 1000;

const previousCeiling = process.env.CLOUDCLI_BG_WAIT_CEILING_MS;
const previousCliCeiling = process.env.CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS;
process.env.CLOUDCLI_BG_WAIT_CEILING_MS = String(CONFIGURED_CEILING_MS);
// The CLI's own variable left in the server's environment must not win over
// the configured ceiling, or the CLI and the hold would disagree.
process.env.CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS = '600000';

const { queryClaudeSDK, resolveBgWaitCeilingMs } = await import('@/modules/providers/list/claude/claude-runtime.provider.js');
const { ClaudeSessionsProvider } = await import('@/modules/providers/list/claude/claude-sessions.provider.js');
const { CLAUDE_PREDEFINED_MODELS } = await import('@/modules/providers/list/claude/claude-models.provider.js');

test.after(() => {
  for (const [name, value] of [
    ['CLOUDCLI_BG_WAIT_CEILING_MS', previousCeiling],
    ['CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS', previousCliCeiling],
  ] as const) {
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }
});

const collectWarnings = () => {
  const warnings: string[] = [];
  return { warnings, warn: (message: string) => { warnings.push(message); } };
};

test('an unset or blank ceiling keeps the 30-minute default', () => {
  const { warnings, warn } = collectWarnings();
  assert.equal(resolveBgWaitCeilingMs(undefined, warn), DEFAULT_CEILING_MS);
  assert.equal(resolveBgWaitCeilingMs('', warn), DEFAULT_CEILING_MS);
  assert.equal(resolveBgWaitCeilingMs('   ', warn), DEFAULT_CEILING_MS);
  assert.deepEqual(warnings, []);
});

test('a whole number of milliseconds is used as given', () => {
  const { warnings, warn } = collectWarnings();
  assert.equal(resolveBgWaitCeilingMs('14400000', warn), 4 * 60 * 60 * 1000);
  assert.equal(resolveBgWaitCeilingMs(' 3600000 ', warn), 60 * 60 * 1000);
  assert.equal(resolveBgWaitCeilingMs('60000', warn), 60 * 1000);
  // The longest delay Node's timers honour is still used as given, without a warning.
  assert.equal(resolveBgWaitCeilingMs('2147483647', warn), 2 ** 31 - 1);
  assert.deepEqual(warnings, []);
});

test('a value under a minute falls back to the default with a warning about the unit', () => {
  // `240` is what a ceiling meant as minutes looks like. Honoured as
  // milliseconds it would end the hold, and the work, almost at once.
  for (const value of ['240', '0', '59999']) {
    const { warnings, warn } = collectWarnings();
    assert.equal(resolveBgWaitCeilingMs(value, warn), DEFAULT_CEILING_MS, value);
    assert.equal(warnings.length, 1, value);
    assert.match(warnings[0], /CLOUDCLI_BG_WAIT_CEILING_MS/);
    assert.match(warnings[0], /milliseconds/);
  }
});

test('a value that is not a whole number falls back to the default with a warning', () => {
  for (const value of ['four hours', '240m', '-60000', '3600000.5', '1.5e7', '0x100000']) {
    const { warnings, warn } = collectWarnings();
    assert.equal(resolveBgWaitCeilingMs(value, warn), DEFAULT_CEILING_MS, value);
    assert.equal(warnings.length, 1, value);
    assert.match(warnings[0], /whole number of milliseconds/);
  }
});

test('a value past the longest Node timer is capped there', () => {
  // setTimeout fires after 1 ms for anything longer, which would end every
  // hold at once instead of never.
  const { warnings, warn } = collectWarnings();
  assert.equal(resolveBgWaitCeilingMs('99999999999', warn), 2 ** 31 - 1);
  assert.equal(warnings.length, 1);
});

/**
 * Starts a run whose turn arms a Monitor, so the process is held. Monitor
 * reports no task events, so nothing but the ceiling ever ends this hold.
 */
async function startHeldRun() {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'claude-bg-ceiling-'));
  const queue: Array<Record<string, unknown> | null> = [];
  let wake: (() => void) | null = null;
  let released = false;
  let cliEnv: Record<string, unknown> | undefined;

  const createQuery: NonNullable<ProviderRuntimeContext['createQuery']> = ({ prompt, options }) => {
    cliEnv = options.env as Record<string, unknown>;
    void (async () => {
      for await (const _message of prompt) { /* the CLI reads its stdin */ }
      released = true;
    })();
    const iterator = (async function* () {
      for (;;) {
        if (queue.length === 0) {
          await new Promise<void>((resolve) => { wake = resolve; });
          wake = null;
          continue;
        }
        const next = queue.shift();
        if (next === null || next === undefined) {
          return;
        }
        yield next;
      }
    })();
    return Object.assign(iterator, { interrupt: async () => {}, stopTask: async () => {} });
  };

  const emit = (message: Record<string, unknown> | null) => { queue.push(message); wake?.(); };
  const sent: NormalizedMessage[] = [];
  const writer = { send: (message: NormalizedMessage) => { sent.push(message); }, userId: null };
  const sessions = new ClaudeSessionsProvider({ getLiveRunStartTime: () => null });
  const context: ProviderRuntimeContext = {
    resolveProviderSessionId: () => null,
    resolveResumeModel: async () => undefined,
    getProviderModels: async () => CLAUDE_PREDEFINED_MODELS as never,
    normalizeMessage: (raw, sessionId) => sessions.normalizeMessage(raw, sessionId),
    isProviderInstalled: async () => true,
    createQuery,
  };

  const done = queryClaudeSDK('watch the build log', { sessionId: 'app-ceiling-session', cwd }, writer as never, context);
  const nativeId = 'native-ceiling-session';
  emit({ type: 'system', subtype: 'init', session_id: nativeId });
  emit({
    type: 'assistant', session_id: nativeId, parent_tool_use_id: null,
    message: { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_monitor', name: 'Monitor', input: { command: 'tail -f build.log', description: 'build log' } }] },
  });
  emit({
    type: 'user', session_id: nativeId, parent_tool_use_id: null,
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_monitor', content: 'Monitor started' }] },
  });

  return {
    cliEnv: () => cliEnv,
    // The run loop has taken every emitted message and waits for the next one.
    drained: () => queue.length === 0 && wake !== null,
    released: () => released,
    sent,
    // The turn ends; from here the process is held for the monitor.
    endTurn: () => emit({ type: 'result', subtype: 'success', session_id: nativeId, result: 'watching', duration_ms: 1, num_turns: 1 }),
    finish: async () => {
      emit(null);
      await done;
      await rm(cwd, { recursive: true, force: true });
    },
  };
}

// Polls on setImmediate rather than a timer, so it keeps working once
// setTimeout is mocked and only ever drives the hold's own countdown.
async function waitUntil(condition: () => boolean): Promise<void> {
  for (let round = 0; round < 5000 && !condition(); round += 1) {
    await new Promise((resolve) => { setImmediate(resolve); });
  }
  assert.ok(condition(), 'condition never became true');
}

// Lets the prompt reader notice a release without waiting for one.
async function flush(): Promise<void> {
  for (let round = 0; round < 20; round += 1) {
    await new Promise((resolve) => { setImmediate(resolve); });
  }
}

test('the configured ceiling is what the CLI is started with', async () => {
  const run = await startHeldRun();
  try {
    await waitUntil(() => run.cliEnv() !== undefined);
    assert.equal(run.cliEnv()?.CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS, String(CONFIGURED_CEILING_MS));
  } finally {
    await run.finish();
  }
});

test('a held session is let go after the configured ceiling of silence', async (t) => {
  const run = await startHeldRun();
  try {
    await waitUntil(run.drained);
    t.mock.timers.enable({ apis: ['setTimeout'] });
    run.endTurn();
    await waitUntil(() => run.drained() && run.sent.some((message) => message.kind === 'complete'));
    assert.ok(run.sent.some((message) => message.kind === 'complete'), 'the turn is over for the client');
    assert.equal(run.released(), false, 'the process is held for the monitor');

    t.mock.timers.tick(CONFIGURED_CEILING_MS - 1);
    await flush();
    assert.equal(run.released(), false, 'still within the ceiling');

    t.mock.timers.tick(1);
    await flush();
    assert.equal(run.released(), true, 'the ceiling of silence ends the hold');
  } finally {
    await run.finish();
  }
});
