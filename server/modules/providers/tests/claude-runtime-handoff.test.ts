import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { ClaudeSessionsProvider } from '@/modules/providers/list/claude/claude-sessions.provider.js';
import { CLAUDE_PREDEFINED_MODELS } from '@/modules/providers/list/claude/claude-models.provider.js';
import { queryClaudeSDK } from '@/modules/providers/list/claude/claude-runtime.provider.js';
import type { NormalizedMessage, ProviderRuntimeContext } from '@/shared/types.js';

/**
 * A turn's CLI process outlives its `result`: stdin is held so background
 * work can report back. The next message for the same session used to spawn
 * a new `claude` straight away and only fire-and-forget an interrupt at the
 * old one, so two processes resumed the same transcript (and worked in the
 * same cwd) until the old one wound down — seconds normally, minutes when it
 * was still busy. This drives two consecutive runs through the scripted SDK
 * seam (`context.createQuery`) and checks the second one is not spawned until
 * the first run's loop has exited.
 */

const SESSION_ID = 'app-handoff-session';
const NATIVE_ID = 'native-handoff-session';

type Scripted = {
  emit: (message: Record<string, unknown>) => void;
  end: () => void;
  released: () => boolean;
  interrupted: () => number;
};

/**
 * Scripted queries for consecutive spawns. Each script exists before its
 * spawn so a test can queue messages ahead of it, exactly like the hold
 * tests' single script; `spawns()` says how many `createQuery` calls the
 * runtime has actually made.
 */
function createScriptedQueries(count: number): {
  createQuery: NonNullable<ProviderRuntimeContext['createQuery']>;
  scripts: Scripted[];
  spawns: () => number;
} {
  const slots = Array.from({ length: count }, () => {
    const queue: Array<Record<string, unknown> | null> = [];
    let wake: (() => void) | null = null;
    const state = { released: false, interrupted: 0 };
    const script: Scripted = {
      emit: (message) => { queue.push(message); wake?.(); },
      end: () => { queue.push(null); wake?.(); },
      released: () => state.released,
      interrupted: () => state.interrupted,
    };
    const take = async () => {
      for (;;) {
        if (queue.length === 0) {
          await new Promise<void>((resolve) => { wake = resolve; });
          wake = null;
          continue;
        }
        return queue.shift();
      }
    };
    return { script, state, take };
  });
  let spawned = 0;

  const createQuery: NonNullable<ProviderRuntimeContext['createQuery']> = ({ prompt }) => {
    const slot = slots[spawned];
    assert.ok(slot, `unexpected spawn #${spawned + 1}`);
    spawned += 1;

    void (async () => {
      for await (const _message of prompt) { /* the CLI reads its stdin */ }
      slot.state.released = true;
    })();

    const iterator = (async function* () {
      for (;;) {
        const next = await slot.take();
        if (next === null || next === undefined) {
          return;
        }
        yield next;
      }
    })();

    return Object.assign(iterator, {
      interrupt: async () => { slot.state.interrupted += 1; },
      stopTask: async () => {},
    });
  };

  return { createQuery, scripts: slots.map((slot) => slot.script), spawns: () => spawned };
}

const settle = () => new Promise((resolve) => { setTimeout(resolve, 25); });

/** Polls for a condition; the first spawn includes real file reads and can take longer than one settle. */
async function waitFor(condition: () => boolean, what: string, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    assert.ok(Date.now() < deadline, `timed out waiting for ${what}`);
    await settle();
  }
}

const init = () => ({ type: 'system', subtype: 'init', session_id: NATIVE_ID });
const result = () => ({ type: 'result', subtype: 'success', session_id: NATIVE_ID, result: 'done', duration_ms: 1, num_turns: 1 });

test('a new turn waits for the previous run of the same session to exit before spawning', async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'claude-runtime-handoff-'));
  const { createQuery, scripts, spawns } = createScriptedQueries(2);
  const [first, second] = scripts;
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

  let firstRun: Promise<void> | null = null;
  let secondRun: Promise<void> | null = null;
  try {
    // Turn 1 answers and ends for the client, but its process is still up:
    // its scripted stream has not ended, like a CLI still winding down (or
    // holding for background work).
    firstRun = queryClaudeSDK('hello', { sessionId: SESSION_ID, cwd }, writer as never, context);
    first.emit(init());
    first.emit(result());
    await waitFor(() => sent.some((message) => message.kind === 'complete'), 'turn 1 to complete');
    assert.equal(spawns(), 1);

    // Turn 2 arrives (from another device, say) while that process lives.
    secondRun = queryClaudeSDK('again', { sessionId: SESSION_ID, cwd }, writer as never, context);
    await waitFor(() => first.interrupted() === 1, 'the previous run to be told to stop');
    assert.equal(first.released(), true, 'its stdin was closed so it can exit');
    await settle();
    assert.equal(spawns(), 1, 'no second process while the first is still running');

    // Only once the first run's loop exits does the second spawn.
    first.end();
    await firstRun;
    await waitFor(() => spawns() === 2, 'the second process to spawn after the first exited');

    second.emit(init());
    second.emit(result());
    await waitFor(() => sent.filter((message) => message.kind === 'complete').length === 2, 'turn 2 to complete');
  } finally {
    // End both streams no matter how the assertions went, so a failure here
    // cannot leave a run behind for the next test's hand-off to wait on.
    first.end();
    second.end();
    await Promise.allSettled([firstRun, secondRun]);
    await rm(cwd, { recursive: true, force: true });
  }
});
