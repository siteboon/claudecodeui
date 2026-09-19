import assert from 'node:assert/strict';
import test from 'node:test';

import {
  HeldClaudeSession,
  releaseHeldSession,
  holdSession,
} from '@/modules/providers/list/claude/claude-held-session.js';
import {
  clearRunLifecycleLog,
  readRunLifecycleEvents,
  recordRunLifecycleEvent,
} from '@/modules/providers/services/run-lifecycle-log.service.js';
import { sessionDiagnosticsService } from '@/modules/providers/services/session-diagnostics.service.js';
import { chatRunRegistry } from '@/modules/websocket/index.js';

/**
 * Six "the session is stuck" reports cost six manual investigations, and four
 * of them found a healthy backend. What was missing was never the data — the
 * server had all of it — but a way to ask for it. These pin down the two
 * halves of the answer: the bounded trace that remembers what a run did, and
 * the snapshot that assembles it with the live registry and held process.
 */

const holdFor = (sessionKey: string) => {
  const session = new HeldClaudeSession({
    sessionKey,
    fingerprint: { cwd: '/tmp/project', model: 'claude-opus-5' },
  });
  holdSession(session);
  return session;
};

test('the trace keeps only the newest events for a session', () => {
  clearRunLifecycleLog();

  for (let index = 0; index < 60; index += 1) {
    recordRunLifecycleEvent('session-a', 'run_start', { sessionKey: 'session-a', index });
  }

  const events = readRunLifecycleEvents('session-a');
  assert.equal(events.length, 50);
  // The oldest ten are gone, not the newest ten.
  assert.equal(events[0].fields.index, 10);
  assert.equal(events[49].fields.index, 59);
});

test('the trace forgets the least recently written session first', () => {
  clearRunLifecycleLog();

  for (let index = 0; index < 205; index += 1) {
    recordRunLifecycleEvent(`session-${index}`, 'run_start', { sessionKey: `session-${index}` });
  }
  // The first five are already gone: 205 sessions against a cap of 200.
  assert.equal(readRunLifecycleEvents('session-0').length, 0);
  // Writing to an early survivor again makes it the most recent, so it must
  // outlive the untouched neighbours that were written just after it.
  recordRunLifecycleEvent('session-10', 'run_end', { sessionKey: 'session-10' });
  for (let index = 205; index < 210; index += 1) {
    recordRunLifecycleEvent(`session-${index}`, 'run_start', { sessionKey: `session-${index}` });
  }

  assert.equal(readRunLifecycleEvents('session-5').length, 0);
  assert.equal(readRunLifecycleEvents('session-10').length, 2);
  assert.equal(readRunLifecycleEvents('session-209').length, 1);
});

test('an event with no session key is logged but not remembered', () => {
  clearRunLifecycleLog();

  recordRunLifecycleEvent(null, 'run_start', {});
  recordRunLifecycleEvent(undefined, 'run_start', {});

  assert.deepEqual(readRunLifecycleEvents(null), []);
});

test('a session nothing is known about reports empty rather than failing', () => {
  clearRunLifecycleLog();
  chatRunRegistry.clearAll();

  const diagnostics = sessionDiagnosticsService.getSessionDiagnostics('never-seen');

  assert.equal(diagnostics.run, null);
  assert.equal(diagnostics.heldProcess, null);
  assert.equal(diagnostics.providerSessionActive, false);
  assert.equal(diagnostics.keepSessionAlive, null);
  assert.deepEqual(diagnostics.lifecycle, []);
});

test('a running turn reports how long it has been running', () => {
  clearRunLifecycleLog();
  chatRunRegistry.clearAll();

  const run = chatRunRegistry.startRun({
    appSessionId: 'session-running',
    provider: 'claude',
    providerSessionId: 'provider-abc',
    connection: null,
    userId: 1,
  });
  assert.ok(run);
  run.startedAt = Date.now() - 90_000;

  const diagnostics = sessionDiagnosticsService.getSessionDiagnostics('session-running');

  assert.equal(diagnostics.run?.status, 'running');
  assert.equal(diagnostics.run?.providerSessionId, 'provider-abc');
  assert.ok((diagnostics.run?.elapsedMs ?? 0) >= 90_000);

  chatRunRegistry.clearAll();
});

test('keepSessionAlive is read back from the most recent run', () => {
  clearRunLifecycleLog();
  chatRunRegistry.clearAll();

  recordRunLifecycleEvent('session-keep', 'run_start', {
    sessionKey: 'session-keep',
    keepSessionAlive: true,
  });
  recordRunLifecycleEvent('session-keep', 'run_end', { sessionKey: 'session-keep' });
  recordRunLifecycleEvent('session-keep', 'run_start', {
    sessionKey: 'session-keep',
    keepSessionAlive: false,
  });

  const diagnostics = sessionDiagnosticsService.getSessionDiagnostics('session-keep');

  assert.equal(diagnostics.keepSessionAlive, false);
  assert.equal(diagnostics.lifecycle.length, 3);
});

test('a held process reports what is left of each hold limit', (t) => {
  clearRunLifecycleLog();
  chatRunRegistry.clearAll();
  const session = holdFor('session-held');
  t.after(() => releaseHeldSession('session-held'));

  session.setOutstandingWork(true);
  session.markHoldArmed({ idleMs: 30 * 60_000, totalMs: 2 * 60 * 60_000 });
  // Armed ten minutes ago, and quiet for the last five of them.
  const armedAt = Date.now() - 10 * 60_000;
  session.holdArmedAt = armedAt;
  session.holdCountdownStartedAt = armedAt;
  session.lastMessageAt = Date.now() - 5 * 60_000;

  const diagnostics = sessionDiagnosticsService.getSessionDiagnostics('session-held');

  assert.equal(diagnostics.heldProcess?.outstandingWork, true);
  // The idle limit runs from the last thing the process said, the total limit
  // from when the hold was armed. Conflating them is what makes a job that has
  // been quiet for five minutes look like one about to be killed.
  assert.ok(Math.abs((diagnostics.heldProcess?.idleReleaseInMs ?? 0) - 25 * 60_000) < 1000);
  assert.ok(Math.abs((diagnostics.heldProcess?.totalReleaseInMs ?? 0) - 110 * 60_000) < 1000);
  assert.equal(diagnostics.heldProcess?.fingerprint?.cwd, '/tmp/project');
});

test('a recurring tick moves the deadline without resetting how long it has been held', (t) => {
  clearRunLifecycleLog();
  const session = holdFor('session-recurring');
  t.after(() => releaseHeldSession('session-recurring'));

  session.markHoldArmed({ idleMs: 30 * 60_000, totalMs: 2 * 60 * 60_000 });
  const armedAt = Date.now() - 90 * 60_000;
  session.holdArmedAt = armedAt;
  session.holdCountdownStartedAt = armedAt;

  // A cron fires: the run re-arms both timers, so the ceiling is a fresh two
  // hours away even though this conversation has been held for ninety minutes.
  const armedAtBeforeTick = session.holdArmedAt;
  session.markHoldArmed({ idleMs: 30 * 60_000, totalMs: 2 * 60 * 60_000 });

  const diagnostics = sessionDiagnosticsService.getSessionDiagnostics('session-recurring');

  assert.equal(session.holdArmedAt, armedAtBeforeTick);
  assert.ok((diagnostics.heldProcess?.totalReleaseInMs ?? 0) > 119 * 60_000);
});

test('the hold limits disappear when the hold is released', (t) => {
  clearRunLifecycleLog();
  const session = holdFor('session-released');
  t.after(() => releaseHeldSession('session-released'));

  session.markHoldArmed({ idleMs: 30 * 60_000, totalMs: 2 * 60 * 60_000 });
  session.clearHold();

  const diagnostics = sessionDiagnosticsService.getSessionDiagnostics('session-released');

  assert.equal(diagnostics.heldProcess?.holdArmedAt, null);
  assert.equal(diagnostics.heldProcess?.idleReleaseInMs, null);
  assert.equal(diagnostics.heldProcess?.totalReleaseInMs, null);
});
