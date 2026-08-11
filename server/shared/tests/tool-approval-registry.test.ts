import assert from 'node:assert/strict';
import test, { mock } from 'node:test';

import type { ProviderPermissionDecision } from '@/shared/types.js';
import {
  getPendingApprovalsForSession,
  registerApproval,
  resolveToolApproval,
  unregisterApproval,
} from '@/shared/tool-approval-registry.js';

const APPROVAL_MAX_AGE_MS = 30 * 60 * 1000;
const SWEEP_INTERVAL_MS = 60 * 1000;
// Expiry is age-based (`now - receivedAt`), so a realistic epoch keeps the
// arithmetic honest and matches what a real run registers.
const CLOCK_START_MS = Date.UTC(2026, 0, 1);

// The registry is a process-wide singleton, so every test uses its own request
// ids and leaves the map empty — a leaked entry would also leave the sweep
// interval armed for the next test.
type Outcome = ProviderPermissionDecision | { cancelled: true };

function collector(): { outcomes: Outcome[]; resolver: (outcome: Outcome) => void } {
  const outcomes: Outcome[] = [];
  return { outcomes, resolver: (outcome) => outcomes.push(outcome) };
}

test('registerApproval exposes the approval to its own session only', () => {
  const receivedAt = new Date('2026-01-01T00:00:00.000Z');
  const { resolver } = collector();

  registerApproval('req-list', {
    resolver,
    sessionId: 'session-a',
    provider: 'claude',
    meta: { toolName: 'Write', input: { file: 'a.txt' }, context: { cwd: '/tmp' }, receivedAt },
  });

  try {
    assert.deepEqual(getPendingApprovalsForSession('session-a'), [
      {
        requestId: 'req-list',
        toolName: 'Write',
        input: { file: 'a.txt' },
        context: { cwd: '/tmp' },
        sessionId: 'session-a',
        provider: 'claude',
        receivedAt,
      },
    ]);
    assert.deepEqual(getPendingApprovalsForSession('session-b'), []);
  } finally {
    unregisterApproval('req-list');
  }
});

test('registerApproval reads the legacy underscore metadata the Claude runtime attaches', () => {
  const receivedAt = new Date('2026-01-01T00:00:00.000Z');
  const { resolver } = collector();

  registerApproval('req-legacy', {
    resolver,
    sessionId: 'session-legacy',
    provider: 'claude',
    meta: { _toolName: 'Bash', _input: { command: 'ls' }, _context: null, _receivedAt: receivedAt },
  });

  try {
    const [pending] = getPendingApprovalsForSession('session-legacy');
    assert.equal(pending?.toolName, 'Bash');
    assert.deepEqual(pending?.input, { command: 'ls' });
    assert.equal(pending?.receivedAt, receivedAt);
  } finally {
    unregisterApproval('req-legacy');
  }
});

test('registerApproval ignores a missing request id or a non-function resolver', () => {
  const { resolver } = collector();

  registerApproval('', { resolver, sessionId: 'session-invalid' });
  registerApproval('req-invalid', {
    resolver: undefined as unknown as (outcome: Outcome) => void,
    sessionId: 'session-invalid',
  });

  assert.deepEqual(getPendingApprovalsForSession('session-invalid'), []);
  assert.equal(resolveToolApproval('req-invalid', { allow: true }), false);
});

test('an unnamed approval falls back to UnknownTool', () => {
  const { resolver } = collector();

  registerApproval('req-unnamed', { resolver, sessionId: 'session-unnamed' });

  try {
    const [pending] = getPendingApprovalsForSession('session-unnamed');
    assert.equal(pending?.toolName, 'UnknownTool');
    assert.equal(pending?.provider, null);
  } finally {
    unregisterApproval('req-unnamed');
  }
});

test('resolveToolApproval delivers an allow decision to the waiting resolver', () => {
  const { outcomes, resolver } = collector();
  const decision: ProviderPermissionDecision = { allow: true, updatedInput: { file: 'b.txt' } };

  registerApproval('req-allow', { resolver, sessionId: 'session-allow', provider: 'claude' });

  try {
    assert.equal(resolveToolApproval('req-allow', decision), true);
    assert.deepEqual(outcomes, [decision]);
  } finally {
    unregisterApproval('req-allow');
  }
});

test('resolveToolApproval delivers a deny decision to the waiting resolver', () => {
  const { outcomes, resolver } = collector();
  const decision: ProviderPermissionDecision = { allow: false, message: 'denied by user' };

  registerApproval('req-deny', { resolver, sessionId: 'session-deny', provider: 'claude' });

  try {
    assert.equal(resolveToolApproval('req-deny', decision), true);
    assert.deepEqual(outcomes, [decision]);
  } finally {
    unregisterApproval('req-deny');
  }
});

test('resolveToolApproval reports an unknown request id instead of throwing', () => {
  assert.equal(resolveToolApproval('req-never-registered', { allow: true }), false);
});

test('unregisterApproval drops the approval without settling its resolver', () => {
  const { outcomes, resolver } = collector();
  let cancellationCount = 0;

  registerApproval('req-unregister', {
    resolver,
    onCancel: () => {
      cancellationCount += 1;
    },
    sessionId: 'session-unregister',
  });
  unregisterApproval('req-unregister');

  assert.deepEqual(getPendingApprovalsForSession('session-unregister'), []);
  assert.deepEqual(outcomes, []);
  assert.equal(cancellationCount, 0);
  // The runtime's own cleanup path must stay idempotent.
  unregisterApproval('req-unregister');
  assert.equal(resolveToolApproval('req-unregister', { allow: true }), false);
});

test('a stalled approval expires on its own timer and cancels the waiter it left hanging', (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'], now: CLOCK_START_MS });
  t.after(() => {
    unregisterApproval('req-stalled');
    mock.timers.reset();
  });

  const { outcomes, resolver } = collector();
  let cancellationCount = 0;

  // No later registerApproval call — the registration-time sweep cannot be what
  // clears this entry, so only the interval can.
  registerApproval('req-stalled', {
    resolver,
    onCancel: () => {
      cancellationCount += 1;
      assert.deepEqual(outcomes, [], 'cancellation must be emitted before the waiter settles');
    },
    sessionId: 'session-stalled',
    provider: 'claude',
    meta: { toolName: 'Write' },
  });

  t.mock.timers.tick(APPROVAL_MAX_AGE_MS);
  assert.deepEqual(outcomes, [], 'an approval inside its window must stay pending');
  assert.equal(getPendingApprovalsForSession('session-stalled').length, 1);

  t.mock.timers.tick(SWEEP_INTERVAL_MS);

  assert.deepEqual(outcomes, [{ cancelled: true }], 'the stalled waiter must be cancelled');
  assert.equal(cancellationCount, 1, 'expiry must emit cancellation exactly once');
  assert.deepEqual(
    getPendingApprovalsForSession('session-stalled'),
    [],
    'the expired approval must be dropped and cannot be replayed',
  );
  // The entry is consumed before cancellation, so a late decision finds nothing.
  assert.equal(resolveToolApproval('req-stalled', { allow: true }), false);
  t.mock.timers.tick(SWEEP_INTERVAL_MS);
  assert.equal(cancellationCount, 1, 'an expired approval must not be cancelled again');
});

test('an approval resolved inside its window is never cancelled by the sweep', (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'], now: CLOCK_START_MS });
  t.after(() => {
    unregisterApproval('req-in-window');
    mock.timers.reset();
  });

  const { outcomes, resolver } = collector();
  let cancellationCount = 0;
  registerApproval('req-in-window', {
    resolver,
    onCancel: () => {
      cancellationCount += 1;
    },
    sessionId: 'session-in-window',
  });

  assert.equal(resolveToolApproval('req-in-window', { allow: true }), true);
  unregisterApproval('req-in-window');
  t.mock.timers.tick(APPROVAL_MAX_AGE_MS + SWEEP_INTERVAL_MS * 2);

  assert.deepEqual(outcomes, [{ allow: true }]);
  assert.equal(cancellationCount, 0);
});

test('the sweep timer never keeps the event loop alive', () => {
  const refdTimeoutsBefore = process
    .getActiveResourcesInfo()
    .filter((resource) => resource === 'Timeout').length;
  const { resolver } = collector();

  registerApproval('req-unref', { resolver, sessionId: 'session-unref' });

  try {
    assert.equal(
      process.getActiveResourcesInfo().filter((resource) => resource === 'Timeout').length,
      refdTimeoutsBefore,
      'the sweep interval must be unref\u2019d, otherwise the server (and this test run) can never exit',
    );
  } finally {
    unregisterApproval('req-unref');
  }
});

test('a non-Date receivedAt is pinned to a real timestamp and still expires', (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'], now: CLOCK_START_MS });
  t.after(() => {
    unregisterApproval('req-bad-date');
    mock.timers.reset();
  });

  const { outcomes, resolver } = collector();

  // The Claude runtime is JavaScript, so the declared `Date` does not hold at
  // runtime. Before coercion this entry read as "unknown age" and was immortal.
  registerApproval('req-bad-date', {
    resolver,
    sessionId: 'session-bad-date',
    meta: { toolName: 'Write', receivedAt: '2026-01-01T00:00:00.000Z' as unknown as Date },
  });

  const [pending] = getPendingApprovalsForSession('session-bad-date');
  assert.ok(pending?.receivedAt instanceof Date, 'the replayed view must carry a real Date');
  assert.equal(pending?.receivedAt.getTime(), CLOCK_START_MS);

  t.mock.timers.tick(APPROVAL_MAX_AGE_MS + SWEEP_INTERVAL_MS);

  assert.deepEqual(outcomes, [{ cancelled: true }]);
  assert.deepEqual(getPendingApprovalsForSession('session-bad-date'), []);
});

test('an approval received at the Unix epoch expires like any other', (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'], now: CLOCK_START_MS });
  t.after(() => {
    unregisterApproval('req-epoch');
    mock.timers.reset();
  });

  const { outcomes, resolver } = collector();

  // A timestamp of 0 is a valid age, not a missing one.
  registerApproval('req-epoch', {
    resolver,
    sessionId: 'session-epoch',
    meta: { receivedAt: new Date(0) },
  });

  t.mock.timers.tick(SWEEP_INTERVAL_MS);

  assert.deepEqual(outcomes, [{ cancelled: true }], 'an epoch-old approval is long expired');
  assert.deepEqual(getPendingApprovalsForSession('session-epoch'), []);
});

test('resolveToolApproval settles a request exactly once', () => {
  const { outcomes, resolver } = collector();

  registerApproval('req-once', { resolver, sessionId: 'session-once', provider: 'claude' });

  try {
    assert.equal(resolveToolApproval('req-once', { allow: true }), true);
    // A duplicate or late `chat.permission-response`, or an abort racing the
    // user's click, must not deliver a second decision.
    assert.equal(resolveToolApproval('req-once', { allow: false }), false);
    assert.deepEqual(outcomes, [{ allow: true }]);
    assert.deepEqual(
      getPendingApprovalsForSession('session-once'),
      [],
      'a settled approval must stop being replayed to a resubscribing client',
    );
  } finally {
    unregisterApproval('req-once');
  }
});

test('an abort cancellation is not emitted again when it settles the approval', () => {
  const { outcomes, resolver } = collector();
  let cancellationCount = 0;
  const emitCancellation = () => {
    cancellationCount += 1;
  };

  registerApproval('req-abort', {
    resolver,
    onCancel: emitCancellation,
    sessionId: 'session-abort',
  });

  // waitForToolApproval emits cancellation before settling the registry entry.
  emitCancellation();
  assert.equal(resolveToolApproval('req-abort', { cancelled: true }), true);
  assert.equal(resolveToolApproval('req-abort', { cancelled: true }), false);
  assert.equal(cancellationCount, 1);
  assert.deepEqual(outcomes, [{ cancelled: true }]);
  assert.deepEqual(getPendingApprovalsForSession('session-abort'), []);
});

test('a resolver that throws still consumes its approval', () => {
  registerApproval('req-throws', {
    resolver: () => { throw new Error('resolver already settled'); },
    sessionId: 'session-throws',
  });

  try {
    assert.equal(resolveToolApproval('req-throws', { allow: true }), true);
    assert.deepEqual(getPendingApprovalsForSession('session-throws'), []);
  } finally {
    unregisterApproval('req-throws');
  }
});
