import assert from 'node:assert/strict';
import test from 'node:test';

import {
  abortClaudeSDKSession,
  addSession,
  getActiveClaudeSDKSessions,
  isClaudeSDKSessionActive,
} from '@/modules/providers/list/claude/claude-runtime.provider.js';

/**
 * Guards for the session registry behind background holds.
 *
 * A held run keeps the CLI process alive past its turn so background work can
 * report back. Two things must stay true of that hold, and neither had any
 * coverage: aborting one has to close the held stdin (or the CLI lingers for
 * the rest of the hold after the user cancelled), and superseding one has to
 * stop the run it replaces (or its generator is stranded with no handle left
 * to interrupt it).
 *
 * Planned work on T2/T3/T4 rewrites exactly this code, so these tests exist to
 * fail loudly if that work regresses either property.
 */

type Spy = { calls: number };

function fakeRun() {
  const interrupted: Spy = { calls: 0 };
  const released: Spy = { calls: 0 };
  const instance = {
    interrupt: async () => {
      interrupted.calls += 1;
    },
  };
  const releaseInput = () => {
    released.calls += 1;
  };
  return { instance, releaseInput, interrupted, released };
}

/** `addSession` interrupts a superseded run on a microtask, so let it settle. */
const settle = () => new Promise((resolve) => setImmediate(resolve));

test('aborting a held run interrupts it and closes the held stdin', async () => {
  const sessionId = `hold-abort-${Date.now()}`;
  const run = fakeRun();
  addSession(sessionId, run.instance, undefined, run.releaseInput);

  assert.equal(isClaudeSDKSessionActive(sessionId), true);

  const aborted = await abortClaudeSDKSession(sessionId);

  assert.equal(aborted, true);
  assert.equal(run.interrupted.calls, 1, 'the run must be interrupted');
  // The regression this file exists for: without it the CLI stays up for the
  // remainder of the hold even though the user cancelled.
  assert.equal(run.released.calls, 1, 'the held stdin must be released');
  assert.equal(getActiveClaudeSDKSessions().includes(sessionId), false, 'no orphan entry may survive');
});

test('a run re-registered mid-run keeps its stdin closer', async () => {
  const sessionId = `hold-rereg-${Date.now()}`;
  const run = fakeRun();
  // The provider re-registers the same instance once the provider session id
  // lands, and passes no closer that second time.
  addSession(sessionId, run.instance, undefined, run.releaseInput);
  addSession(sessionId, run.instance, undefined, undefined);

  await abortClaudeSDKSession(sessionId);

  assert.equal(run.released.calls, 1, 'the carried closer must survive re-registration');
});

test('superseding a run stops it and releases its stdin', async () => {
  const sessionId = `hold-supersede-${Date.now()}`;
  const first = fakeRun();
  const second = fakeRun();

  addSession(sessionId, first.instance, undefined, first.releaseInput);
  addSession(sessionId, second.instance, undefined, second.releaseInput);
  await settle();

  assert.equal(first.interrupted.calls, 1, 'the replaced run must be interrupted');
  assert.equal(first.released.calls, 1, 'the replaced run must release its stdin');
  assert.equal(second.interrupted.calls, 0, 'the new run must be left alone');
  assert.equal(isClaudeSDKSessionActive(sessionId), true);

  await abortClaudeSDKSession(sessionId);
  assert.equal(second.interrupted.calls, 1, 'abort must reach the surviving run');
});

test('aborting an unknown session reports failure instead of throwing', async () => {
  assert.equal(await abortClaudeSDKSession(`missing-${Date.now()}`), false);
});

test('aborting twice does not double-interrupt', async () => {
  const sessionId = `hold-twice-${Date.now()}`;
  const run = fakeRun();
  addSession(sessionId, run.instance, undefined, run.releaseInput);

  assert.equal(await abortClaudeSDKSession(sessionId), true);
  assert.equal(await abortClaudeSDKSession(sessionId), false, 'the entry is gone after the first abort');
  assert.equal(run.interrupted.calls, 1);
});
