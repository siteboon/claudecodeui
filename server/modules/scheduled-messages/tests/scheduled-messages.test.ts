import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { TestContext } from 'node:test';

import { closeConnection, initializeDatabase, scheduledMessagesDb, sessionDraftsDb, sessionsDb, userDb } from '@/modules/database/index.js';
import {
  closeScheduledMessageDispatcher,
  dispatchDueScheduledMessages,
  dispatchQueuedMessages,
  initializeScheduledMessageDispatcher,
} from '@/modules/scheduled-messages/services/scheduled-message-dispatcher.service.js';
import { scheduledMessagesService } from '@/modules/scheduled-messages/services/scheduled-messages.service.js';
import { chatRunRegistry } from '@/modules/websocket/index.js';

const SESSION_ID = 'scheduled-session';

async function withIsolatedDatabase(runTest: (userId: number) => void | Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'scheduled-messages-'));

  closeConnection();
  process.env.DATABASE_PATH = path.join(tempDirectory, 'auth.db');
  await initializeDatabase();

  try {
    const user = userDb.createUser('scheduler', 'hash');
    sessionsDb.createAppSession(SESSION_ID, 'claude', tempDirectory, 'Scheduled session');
    await runTest(Number(user.id));
  } finally {
    chatRunRegistry.clearAll();
    closeConnection();
    if (previousDatabasePath === undefined) {
      delete process.env.DATABASE_PATH;
    } else {
      process.env.DATABASE_PATH = previousDatabasePath;
    }
    await rm(tempDirectory, { recursive: true, force: true });
  }
}

type RunCall = { provider: string; command: string; options: Record<string, unknown> };

function createRuntime(runs: RunCall[], behaviour: 'ok' | 'throw' = 'ok', aborts: string[] = []) {
  return {
    hasRuntime: () => true,
    run: async (provider: string, command: string, options: Record<string, unknown>) => {
      if (behaviour === 'throw') {
        throw new Error('provider exploded');
      }
      runs.push({ provider, command, options });
    },
    abort: async (_provider: string, sessionId: string) => {
      aborts.push(sessionId);
      return true;
    },
  } as never;
}

test('a message due in the past is sent on the next pass, not skipped', async () => {
  await withIsolatedDatabase(async (userId) => {
    // The server was down when this came due.
    scheduledMessagesService.schedule({
      userId,
      sessionId: SESSION_ID,
      content: 'run the nightly checks',
      scheduledFor: new Date(Date.now() - 60_000).toISOString(),
    });

    const runs: RunCall[] = [];
    const sent = await dispatchDueScheduledMessages(createRuntime(runs));

    assert.equal(sent, 1);
    assert.equal(runs.length, 1);
    assert.equal(runs[0].command, 'run the nightly checks');
    assert.equal(scheduledMessagesDb.listForSession(userId, SESSION_ID)[0].status, 'sent');
  });
});

test('a queued message is sent by the server without a browser connection', async () => {
  await withIsolatedDatabase(async (userId) => {
    sessionDraftsDb.saveDraft(userId, SESSION_ID, {
      text: '',
      queuedMessage: {
        content: 'continue on the VPS',
        options: { model: 'claude-opus-5' },
        attachments: [{ path: '/tmp/upload.png' }],
      },
    });

    const runs: RunCall[] = [];
    assert.equal(await dispatchQueuedMessages(createRuntime(runs)), 1);
    assert.equal(runs.length, 1);
    assert.equal(runs[0].command, 'continue on the VPS');
    assert.equal(runs[0].options.model, 'claude-opus-5');
    assert.deepEqual(runs[0].options.attachments, []);
    assert.equal(sessionDraftsDb.getDrafts(userId).length, 0);
  });
});

test('a queued message stays pending while its session is busy', async () => {
  await withIsolatedDatabase(async (userId) => {
    sessionDraftsDb.saveDraft(userId, SESSION_ID, {
      text: '',
      queuedMessage: { content: 'send after this run' },
    });
    chatRunRegistry.startRun({
      appSessionId: SESSION_ID,
      provider: 'claude',
      providerSessionId: null,
      connection: null,
      userId,
    });

    const runs: RunCall[] = [];
    assert.equal(await dispatchQueuedMessages(createRuntime(runs)), 0);
    assert.equal(runs.length, 0);
    assert.deepEqual(sessionDraftsDb.getDrafts(userId)[0]?.queuedMessage, {
      content: 'send after this run',
    });
  });
});

test('a due message interrupts a run in progress instead of failing', async () => {
  await withIsolatedDatabase(async (userId) => {
    scheduledMessagesService.schedule({
      userId,
      sessionId: SESSION_ID,
      content: 'the schedule wins',
      scheduledFor: new Date(Date.now() - 1_000).toISOString(),
    });
    chatRunRegistry.startRun({
      appSessionId: SESSION_ID,
      provider: 'claude',
      providerSessionId: null,
      connection: null,
      userId,
    });

    const runs: RunCall[] = [];
    const aborts: string[] = [];
    assert.equal(await dispatchDueScheduledMessages(createRuntime(runs, 'ok', aborts)), 1);

    assert.deepEqual(aborts, [SESSION_ID]);
    assert.equal(runs.length, 1);
    assert.equal(runs[0].command, 'the schedule wins');
    assert.equal(scheduledMessagesDb.listForSession(userId, SESSION_ID)[0].status, 'sent');
  });
});

test('a message that is not due yet is left alone', async () => {
  await withIsolatedDatabase(async (userId) => {
    scheduledMessagesService.schedule({
      userId,
      sessionId: SESSION_ID,
      content: 'later',
      scheduledFor: new Date(Date.now() + 3_600_000).toISOString(),
    });

    const runs: RunCall[] = [];
    assert.equal(await dispatchDueScheduledMessages(createRuntime(runs)), 0);
    assert.equal(runs.length, 0);
    assert.equal(scheduledMessagesDb.listForSession(userId, SESSION_ID)[0].status, 'pending');
  });
});

test('a due message is claimed once, so overlapping passes cannot double-send it', async () => {
  await withIsolatedDatabase(async (userId) => {
    scheduledMessagesService.schedule({
      userId,
      sessionId: SESSION_ID,
      content: 'only once',
      scheduledFor: new Date(Date.now() - 1_000).toISOString(),
    });

    const runs: RunCall[] = [];
    const runtime = createRuntime(runs);
    await Promise.all([
      dispatchDueScheduledMessages(runtime),
      dispatchDueScheduledMessages(runtime),
    ]);

    assert.equal(runs.length, 1);
  });
});

test('the composer settings it was scheduled with travel with it', async () => {
  await withIsolatedDatabase(async (userId) => {
    scheduledMessagesService.schedule({
      userId,
      sessionId: SESSION_ID,
      content: 'with options',
      options: { model: 'claude-opus-5', permissionMode: 'plan' },
      scheduledFor: new Date(Date.now() - 1_000).toISOString(),
    });

    const runs: RunCall[] = [];
    await dispatchDueScheduledMessages(createRuntime(runs));

    assert.equal(runs[0].options.model, 'claude-opus-5');
    assert.equal(runs[0].options.permissionMode, 'plan');
  });
});

test('a provider failure is recorded on the message instead of vanishing', async () => {
  await withIsolatedDatabase(async (userId) => {
    scheduledMessagesService.schedule({
      userId,
      sessionId: SESSION_ID,
      content: 'will fail',
      scheduledFor: new Date(Date.now() - 1_000).toISOString(),
    });

    await dispatchDueScheduledMessages(createRuntime([], 'throw'));

    const row = scheduledMessagesDb.listForSession(userId, SESSION_ID)[0];
    assert.equal(row.status, 'failed');
    assert.match(row.failure_reason ?? '', /provider exploded/);
  });
});

test('a cancelled message never fires', async () => {
  await withIsolatedDatabase(async (userId) => {
    const scheduled = scheduledMessagesService.schedule({
      userId,
      sessionId: SESSION_ID,
      content: 'never mind',
      scheduledFor: new Date(Date.now() - 1_000).toISOString(),
    });
    scheduledMessagesService.cancel(userId, scheduled.id);

    const runs: RunCall[] = [];
    assert.equal(await dispatchDueScheduledMessages(createRuntime(runs)), 0);
    assert.equal(runs.length, 0);
  });
});

test('a failed message can be dismissed, and stays dismissed', async () => {
  await withIsolatedDatabase(async (userId) => {
    const scheduled = scheduledMessagesService.schedule({
      userId,
      sessionId: SESSION_ID,
      content: 'will fail',
      scheduledFor: new Date(Date.now() - 1_000).toISOString(),
    });
    await dispatchDueScheduledMessages(createRuntime([], 'throw'));
    assert.equal(scheduledMessagesDb.listForSession(userId, SESSION_ID)[0].status, 'failed');

    scheduledMessagesService.cancel(userId, scheduled.id);

    assert.equal(scheduledMessagesDb.listForSession(userId, SESSION_ID)[0].status, 'cancelled');
  });
});

test('cancelling something that already fired is refused', async () => {
  await withIsolatedDatabase(async (userId) => {
    const scheduled = scheduledMessagesService.schedule({
      userId,
      sessionId: SESSION_ID,
      content: 'gone',
      scheduledFor: new Date(Date.now() - 1_000).toISOString(),
    });
    await dispatchDueScheduledMessages(createRuntime([]));

    assert.throws(
      () => scheduledMessagesService.cancel(userId, scheduled.id),
      (error: Error & { code?: string }) => error.code === 'SCHEDULED_MESSAGE_NOT_PENDING',
    );
  });
});

test('one user cannot cancel another user\'s scheduled message', async () => {
  await withIsolatedDatabase(async (userId) => {
    const scheduled = scheduledMessagesService.schedule({
      userId,
      sessionId: SESSION_ID,
      content: 'mine',
      scheduledFor: new Date(Date.now() + 3_600_000).toISOString(),
    });

    assert.throws(
      () => scheduledMessagesService.cancel(userId + 1, scheduled.id),
      (error: Error & { code?: string }) => error.code === 'SCHEDULED_MESSAGE_NOT_PENDING',
    );
    assert.equal(scheduledMessagesDb.listForSession(userId, SESSION_ID)[0].status, 'pending');
  });
});

test('scheduling validates its input', async () => {
  await withIsolatedDatabase(async (userId) => {
    const base = { userId, sessionId: SESSION_ID, scheduledFor: new Date(Date.now() + 1000).toISOString() };

    assert.throws(
      () => scheduledMessagesService.schedule({ ...base, content: '   ' }),
      (error: Error & { code?: string }) => error.code === 'CONTENT_REQUIRED',
    );
    assert.throws(
      () => scheduledMessagesService.schedule({ ...base, content: 'hi', scheduledFor: 'not a date' }),
      (error: Error & { code?: string }) => error.code === 'INVALID_SCHEDULE_TIME',
    );
    assert.throws(
      () => scheduledMessagesService.schedule({
        ...base,
        content: 'hi',
        scheduledFor: new Date(Date.now() + 400 * 24 * 3600 * 1000).toISOString(),
      }),
      (error: Error & { code?: string }) => error.code === 'SCHEDULE_TOO_FAR_AHEAD',
    );
    assert.throws(
      () => scheduledMessagesService.schedule({ ...base, sessionId: 'nope', content: 'hi' }),
      (error: Error & { code?: string }) => error.code === 'SESSION_NOT_FOUND',
    );
  });
});

// ---------------------------------------------------------------------------
// A detached turn can stay open indefinitely: a Claude permission prompt now
// waits for an answer instead of timing out after 55 s (#607), and nobody is
// watching a scheduled or queued run. Such a turn must hold up only its own
// session, never the dispatch of every other session's messages.

const OTHER_SESSION_ID = 'scheduled-session-other';
const THIRD_SESSION_ID = 'scheduled-session-third';
const HELD = 'waits on a permission prompt';

/**
 * A runtime whose runs for the held commands stay open until the test releases
 * them: `release(command)` ends that one, `release()` ends them all.
 */
function createHeldRuntime(heldCommands: readonly string[] = [HELD]) {
  const runs: RunCall[] = [];
  const aborts: string[] = [];
  const openRuns: Array<{ command: string; end: () => void }> = [];
  const runtime = {
    hasRuntime: () => true,
    run: async (provider: string, command: string, options: Record<string, unknown>) => {
      runs.push({ provider, command, options });
      if (heldCommands.includes(command)) {
        await new Promise<void>((resolve) => { openRuns.push({ command, end: resolve }); });
      }
    },
    abort: async (_provider: string, sessionId: string) => {
      aborts.push(sessionId);
      return true;
    },
  } as never;
  const release = (command?: string) => {
    for (const openRun of [...openRuns]) {
      if (command === undefined || openRun.command === command) {
        openRuns.splice(openRuns.indexOf(openRun), 1);
        openRun.end();
      }
    }
  };
  return { runtime, runs, aborts, release };
}

const commandsRun = (runs: RunCall[]) => runs.map((run) => run.command);

/** Waits in real time, bounded, until `condition` holds. */
async function waitUntil(condition: () => boolean, description: string): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (!condition()) {
    if (Date.now() > deadline) {
      assert.fail(`timed out waiting until ${description}`);
    }
    await new Promise((resolve) => { setTimeout(resolve, 5); });
  }
}

/** Gives any run that is about to start the chance to. */
const settle = () => new Promise((resolve) => { setTimeout(resolve, 20); });

const scheduleDue = (userId: number, sessionId: string, content: string, secondsAgo = 1) => (
  scheduledMessagesService.schedule({
    userId,
    sessionId,
    content,
    scheduledFor: new Date(Date.now() - secondsAgo * 1_000).toISOString(),
  })
);

const queueTurn = (userId: number, sessionId: string, content: string) => {
  sessionDraftsDb.saveDraft(userId, sessionId, { text: '', queuedMessage: { content } });
};

/** The stored status of the session's scheduled message with this text. */
const statusOf = (userId: number, content: string) => (
  scheduledMessagesDb.listForSession(userId, SESSION_ID).find((row) => row.content === content)?.status
);

/**
 * Releases the held run and lets everything it was holding up finish while the
 * isolated database is still open.
 */
async function releaseAndDrain(release: () => void): Promise<void> {
  closeScheduledMessageDispatcher();
  release();
  await settle();
}

test('a turn that never ends holds up only its own session within a pass', async () => {
  await withIsolatedDatabase(async (userId) => {
    sessionsDb.createAppSession(OTHER_SESSION_ID, 'claude', tmpdir(), 'Other session');
    scheduleDue(userId, SESSION_ID, HELD, 3);
    scheduleDue(userId, SESSION_ID, 'next in the same session', 2);
    scheduleDue(userId, OTHER_SESSION_ID, 'another session', 1);

    const { runtime, runs, aborts, release } = createHeldRuntime();
    const pass = dispatchDueScheduledMessages(runtime);
    try {
      await waitUntil(() => commandsRun(runs).includes('another session'), 'the other session is sent to');
      assert.deepEqual(
        commandsRun(runs),
        [HELD, 'another session'],
        'the same session\'s next message waits for the held turn',
      );
      assert.deepEqual(aborts, [], 'nothing interrupted the held turn');
      assert.equal(statusOf(userId, 'next in the same session'), 'pending', 'nor is it marked sent before it goes');
    } finally {
      await releaseAndDrain(release);
    }

    assert.equal(await pass, 3);
    assert.deepEqual(commandsRun(runs), [HELD, 'another session', 'next in the same session']);
  });
});

for (const heldKind of ['scheduled', 'queued'] as const) {
  test(`a ${heldKind} turn that never ends does not stop the next poll for other sessions`, async (t: TestContext) => {
    await withIsolatedDatabase(async (userId) => {
      sessionsDb.createAppSession(OTHER_SESSION_ID, 'claude', tmpdir(), 'Other session');
      sessionsDb.createAppSession(THIRD_SESSION_ID, 'claude', tmpdir(), 'Third session');
      if (heldKind === 'scheduled') {
        scheduleDue(userId, SESSION_ID, HELD);
      } else {
        queueTurn(userId, SESSION_ID, HELD);
      }

      const { runtime, runs, release } = createHeldRuntime();
      t.mock.timers.enable({ apis: ['setInterval'] });
      try {
        initializeScheduledMessageDispatcher(runtime);
        await waitUntil(() => commandsRun(runs).includes(HELD), 'the held turn starts');

        // Both come due while the held turn is still waiting for its answer.
        scheduleDue(userId, OTHER_SESSION_ID, 'scheduled elsewhere');
        queueTurn(userId, THIRD_SESSION_ID, 'queued elsewhere');
        t.mock.timers.tick(30_000);

        await waitUntil(
          () => ['scheduled elsewhere', 'queued elsewhere'].every((command) => commandsRun(runs).includes(command)),
          'the next poll sends the other sessions\' messages',
        );
      } finally {
        await releaseAndDrain(release);
      }
    });
  });
}

for (const heldKind of ['scheduled', 'queued'] as const) {
  test(`a message that comes due behind its session's waiting ${heldKind} turn runs after it, not over it`, async (t: TestContext) => {
    await withIsolatedDatabase(async (userId) => {
      if (heldKind === 'scheduled') {
        scheduleDue(userId, SESSION_ID, HELD);
      } else {
        queueTurn(userId, SESSION_ID, HELD);
      }

      const { runtime, runs, aborts, release } = createHeldRuntime();
      t.mock.timers.enable({ apis: ['setInterval'] });
      try {
        initializeScheduledMessageDispatcher(runtime);
        await waitUntil(() => runs.length === 1, 'the held turn starts');

        // A scheduled message interrupts a run the user is watching, but not a
        // turn the dispatcher itself is still sending into the same session.
        scheduleDue(userId, SESSION_ID, 'due later');
        t.mock.timers.tick(30_000);
        await settle();
        assert.deepEqual(commandsRun(runs), [HELD], 'the later message does not race into the busy session');
        assert.deepEqual(aborts, [], 'nor does it interrupt the turn ahead of it');
        assert.equal(statusOf(userId, 'due later'), 'pending', 'and it is not marked sent before it goes');

        release();
        await settle();
        t.mock.timers.tick(30_000);
        await waitUntil(() => runs.length === 2, 'the later message is sent once the session is free');
        t.mock.timers.tick(30_000);
        await settle();
        assert.deepEqual(commandsRun(runs), [HELD, 'due later'], 'in order, and once');
        assert.deepEqual(aborts, []);
      } finally {
        await releaseAndDrain(release);
      }
    });
  });
}

test('a queued turn is not sent into a session the dispatcher is still sending to', async (t: TestContext) => {
  await withIsolatedDatabase(async (userId) => {
    scheduleDue(userId, SESSION_ID, HELD);

    const { runtime, runs, aborts, release } = createHeldRuntime();
    t.mock.timers.enable({ apis: ['setInterval'] });
    try {
      initializeScheduledMessageDispatcher(runtime);
      await waitUntil(() => runs.length === 1, 'the held turn starts');
      scheduleDue(userId, SESSION_ID, 'due later');
      t.mock.timers.tick(30_000);
      await settle();

      // The user stops the held turn from the browser: the session reads as
      // idle straight away, while the provider run is still winding down.
      // Claiming the queued turn now would take it out of the draft only to
      // leave it waiting in memory behind that run.
      chatRunRegistry.completeRun(SESSION_ID, { exitCode: 0, aborted: true });
      queueTurn(userId, SESSION_ID, 'queued meanwhile');
      t.mock.timers.tick(30_000);
      await settle();
      assert.deepEqual(commandsRun(runs), [HELD], 'the queued turn is left for a later poll');
      assert.deepEqual(sessionDraftsDb.getDrafts(userId)[0]?.queuedMessage, { content: 'queued meanwhile' });
      assert.equal(statusOf(userId, 'due later'), 'pending');

      release();
      await settle();
      t.mock.timers.tick(30_000);
      await waitUntil(() => runs.length === 2, 'the scheduled message that came due goes first');
      await settle();
      t.mock.timers.tick(30_000);
      await waitUntil(() => runs.length === 3, 'the queued turn follows on the next poll');
      assert.deepEqual(commandsRun(runs), [HELD, 'due later', 'queued meanwhile']);
      assert.deepEqual(aborts, [], 'nothing was interrupted');
    } finally {
      await releaseAndDrain(release);
    }
  });
});

/**
 * How a message ends up waiting behind its session's held turn: due in the same
 * poll as that turn (the server was down or the machine asleep past both, or
 * the two were scheduled close together), or coming due in a later poll while
 * the held turn is already waiting.
 */
const ARRIVALS = ['in the same poll', 'in a later poll'] as const;

/**
 * Starts the dispatcher on a held turn with a message due behind it in the
 * same session, and returns that message once it is lined up.
 */
async function startBehindHeldTurn(
  t: TestContext,
  userId: number,
  arrival: typeof ARRIVALS[number],
  { runtime, runs }: ReturnType<typeof createHeldRuntime>,
) {
  scheduleDue(userId, SESSION_ID, HELD, 2);
  const sameArrival = arrival === 'in the same poll' ? scheduleDue(userId, SESSION_ID, 'due later', 1) : null;
  t.mock.timers.enable({ apis: ['setInterval'] });
  initializeScheduledMessageDispatcher(runtime);
  await waitUntil(() => runs.length === 1, 'the held turn starts');
  const later = sameArrival ?? scheduleDue(userId, SESSION_ID, 'due later');
  if (!sameArrival) {
    t.mock.timers.tick(30_000);
  }
  await settle();
  return later;
}

for (const arrival of ARRIVALS) {
  test(`a message that comes due behind its session's waiting turn ${arrival} can still be cancelled`, async (t: TestContext) => {
    await withIsolatedDatabase(async (userId) => {
      const held = createHeldRuntime();
      const { runs, aborts, release } = held;
      try {
        const later = await startBehindHeldTurn(t, userId, arrival, held);

        // Still listed as waiting to go, which is what the composer shows and
        // what lets the user take it back.
        assert.equal(statusOf(userId, 'due later'), 'pending', 'it is not marked sent before it goes');
        assert.deepEqual(scheduledMessagesService.listPending(userId).map((message) => message.content), ['due later']);
        scheduledMessagesService.cancel(userId, later.id);

        release();
        await settle();
        t.mock.timers.tick(30_000);
        await settle();
        assert.deepEqual(commandsRun(runs), [HELD], 'a cancelled message never fires');
        assert.deepEqual(aborts, []);
        assert.equal(statusOf(userId, 'due later'), 'cancelled');
      } finally {
        await releaseAndDrain(release);
      }
    });
  });

  test(`a message that comes due behind its session's waiting turn ${arrival} is not lost to a restart`, async (t: TestContext) => {
    await withIsolatedDatabase(async (userId) => {
      const held = createHeldRuntime();
      try {
        await startBehindHeldTurn(t, userId, arrival, held);

        // The server goes down with the held turn still open. Nothing about the
        // session survives in memory, so the new process's first poll finds
        // only what the database still has pending.
        closeScheduledMessageDispatcher();
        assert.deepEqual(scheduledMessagesDb.listDue(new Date()).map((row) => row.content), ['due later']);
      } finally {
        await releaseAndDrain(held.release);
      }
    });
  });
}

test('a turn lined up behind another keeps its session taken once the first one ends', async (t: TestContext) => {
  await withIsolatedDatabase(async (userId) => {
    // Due in the same pass, so the second is lined up behind the first.
    scheduleDue(userId, SESSION_ID, 'first', 2);
    scheduleDue(userId, SESSION_ID, 'second', 1);

    const { runtime, runs, aborts, release } = createHeldRuntime(['first', 'second']);
    t.mock.timers.enable({ apis: ['setInterval'] });
    try {
      initializeScheduledMessageDispatcher(runtime);
      await waitUntil(() => runs.length === 1, 'the first turn starts');
      release('first');
      await waitUntil(() => runs.length === 2, 'the second turn follows it');

      // The first turn has ended, but the dispatcher is still sending the
      // second, so a third that comes due now waits for it.
      scheduleDue(userId, SESSION_ID, 'third');
      t.mock.timers.tick(30_000);
      await settle();
      assert.deepEqual(commandsRun(runs), ['first', 'second']);
      assert.deepEqual(aborts, [], 'the third does not interrupt the second');
      assert.equal(statusOf(userId, 'third'), 'pending');

      release('second');
      await settle();
      t.mock.timers.tick(30_000);
      await waitUntil(() => runs.length === 3, 'the third goes once the session is free');
      assert.deepEqual(commandsRun(runs), ['first', 'second', 'third']);
      assert.deepEqual(aborts, []);
    } finally {
      await releaseAndDrain(release);
    }
  });
});

test('a pass leaves a session alone while the dispatcher is still sending to it', async () => {
  await withIsolatedDatabase(async (userId) => {
    scheduleDue(userId, SESSION_ID, HELD);

    const { runtime, runs, release } = createHeldRuntime();
    const firstPass = dispatchDueScheduledMessages(runtime);
    try {
      await waitUntil(() => runs.length === 1, 'the held turn starts');

      // Picked up now, it would only be lined up behind the held turn, and the
      // pass would wait on that turn for as long as its prompt goes unanswered.
      scheduleDue(userId, SESSION_ID, 'due later');
      const secondPass = dispatchDueScheduledMessages(runtime);
      const stillWaiting = new Promise((resolve) => { setTimeout(resolve, 200, 'still waiting'); });
      assert.equal(await Promise.race([secondPass, stillWaiting]), 0, 'the busy session is skipped');
      assert.equal(statusOf(userId, 'due later'), 'pending');
    } finally {
      await releaseAndDrain(release);
    }

    assert.equal(await firstPass, 1);
    assert.deepEqual(commandsRun(runs), [HELD], 'the skipped message waits for a later poll');
  });
});

test('a message lined up behind one that failed outright is still sent', async (t: TestContext) => {
  await withIsolatedDatabase(async (userId) => {
    scheduleDue(userId, SESSION_ID, 'fails', 2);
    scheduleDue(userId, SESSION_ID, 'after the failure', 1);

    const runs: RunCall[] = [];
    const runtime = {
      hasRuntime: () => true,
      run: async (provider: string, command: string, options: Record<string, unknown>) => {
        if (command === 'fails') {
          throw new Error('provider exploded');
        }
        runs.push({ provider, command, options });
      },
      abort: async () => true,
    } as never;
    // Not even the failure can be recorded, so the first turn itself rejects.
    t.mock.method(scheduledMessagesDb, 'markFailed', () => {
      throw new Error('database is locked');
    });

    await assert.rejects(dispatchDueScheduledMessages(runtime), /database is locked/);
    await waitUntil(() => commandsRun(runs).includes('after the failure'), 'the next message is sent anyway');
  });
});

test('a due scheduled message goes before a queued turn for the same session', async (t: TestContext) => {
  await withIsolatedDatabase(async (userId) => {
    queueTurn(userId, SESSION_ID, 'queued');
    scheduleDue(userId, SESSION_ID, 'scheduled');

    // The scheduled turn stays open, as one waiting on a permission prompt can.
    const { runtime, runs, aborts, release } = createHeldRuntime(['scheduled']);
    t.mock.timers.enable({ apis: ['setInterval'] });
    try {
      initializeScheduledMessageDispatcher(runtime);
      await waitUntil(() => runs.length === 1, 'one of them starts');
      await settle();
      assert.deepEqual(commandsRun(runs), ['scheduled'], 'the message due at a time the user picked goes first');
      assert.deepEqual(sessionDraftsDb.getDrafts(userId)[0]?.queuedMessage, { content: 'queued' });

      release('scheduled');
      await settle();
      t.mock.timers.tick(30_000);
      await waitUntil(() => runs.length === 2, 'the queued turn follows on the next poll');
      assert.deepEqual(commandsRun(runs), ['scheduled', 'queued']);
      assert.deepEqual(aborts, []);
    } finally {
      await releaseAndDrain(release);
    }
  });
});
