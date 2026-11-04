import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, getConnection, initializeDatabase, scheduledMessagesDb, sessionDraftsDb, sessionsDb, userDb } from '@/modules/database/index.js';
import { closeScheduledMessageDispatcher, dispatchDueScheduledMessages, dispatchQueuedMessages, initializeScheduledMessageDispatcher } from '@/modules/scheduled-messages/services/scheduled-message-dispatcher.service.js';
import { scheduledMessagesService } from '@/modules/scheduled-messages/services/scheduled-messages.service.js';
import { chatRunRegistry, connectedClients, runDetachedChatTurn } from '@/modules/websocket/index.js';
import type { ProviderRuntimeGateway } from '@/modules/websocket/index.js';

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
    closeScheduledMessageDispatcher();
    chatRunRegistry.clearAll();
    connectedClients.clear();
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

function createRuntime(
  runs: RunCall[],
  behaviour: 'ok' | 'throw' = 'ok',
  aborts: string[] = [],
  hasBackgroundWork: (sessionId: string) => boolean = () => false,
): ProviderRuntimeGateway {
  return {
    hasRuntime: () => true,
    hasBackgroundWork,
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
    stopBackgroundTask: async () => false,
    resolveToolApproval: () => {},
    getPendingApprovalsForSession: () => [],
  };
}

/** A chat socket that records what it is sent, standing in for an open browser tab. */
class FakeConnection {
  readyState = 1; // WS_OPEN_STATE
  frames: Array<Record<string, unknown>> = [];

  send(data: string): void {
    this.frames.push(JSON.parse(data) as Record<string, unknown>);
  }

  /** The scheduled-message announcements among everything this socket received. */
  announcements(): Array<Record<string, unknown>> {
    return this.frames.filter((frame) => frame.kind === 'scheduled_messages_changed');
  }
}

function openTab(): FakeConnection {
  const connection = new FakeConnection();
  connectedClients.add(connection as never);
  return connection;
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

test('a queued message waits for background work its session\'s last turn left running', async () => {
  await withIsolatedDatabase(async (userId) => {
    sessionDraftsDb.saveDraft(userId, SESSION_ID, {
      text: '',
      queuedMessage: { content: 'send after the background job' },
    });
    // Turn A ended, so its run is completed, but it backgrounded a command
    // that is still running under A's CLI process.
    const runA = chatRunRegistry.startRun({
      appSessionId: SESSION_ID,
      provider: 'claude',
      providerSessionId: null,
      connection: null,
      userId,
    });
    runA!.writer.sendComplete({ exitCode: 0 });
    assert.equal(chatRunRegistry.isProcessing(SESSION_ID), false);

    let backgroundWork = true;
    const runs: RunCall[] = [];
    const runtime = createRuntime(runs, 'ok', [], (sessionId) => sessionId === SESSION_ID && backgroundWork);

    // Starting B now would replace that process and stop the command.
    assert.equal(await dispatchQueuedMessages(runtime), 0);
    assert.equal(runs.length, 0);
    assert.deepEqual(sessionDraftsDb.getDrafts(userId)[0]?.queuedMessage, {
      content: 'send after the background job',
    });

    // Once the work has reported back, B goes on the next pass.
    backgroundWork = false;
    assert.equal(await dispatchQueuedMessages(runtime), 1);
    assert.equal(runs.length, 1);
    assert.equal(runs[0].command, 'send after the background job');
    assert.equal(sessionDraftsDb.getDrafts(userId).length, 0);
  });
});

test('follow-ups queued during one turn are all sent, once, in order, as the next turn', async () => {
  await withIsolatedDatabase(async (userId) => {
    for (const content of ['follow-up A', 'follow-up B', 'follow-up C']) {
      sessionDraftsDb.appendQueuedMessage(userId, SESSION_ID, { content, options: { model: 'opus' }, attachments: [] });
    }

    const runs: RunCall[] = [];
    assert.equal(await dispatchQueuedMessages(createRuntime(runs)), 1);
    assert.equal(await dispatchQueuedMessages(createRuntime(runs)), 0, 'nothing is left to send');

    assert.equal(runs.length, 1);
    assert.equal(runs[0].command, 'follow-up A\n\nfollow-up B\n\nfollow-up C');
    assert.equal(runs[0].options.model, 'opus');
    assert.equal(sessionDraftsDb.getDrafts(userId).length, 0);
  });
});

test('a draft-text save after the queued message was sent does not send it again', async () => {
  await withIsolatedDatabase(async (userId) => {
    sessionDraftsDb.appendQueuedMessage(userId, SESSION_ID, { content: 'send me once', attachments: [] });
    const runs: RunCall[] = [];
    assert.equal(await dispatchQueuedMessages(createRuntime(runs)), 1);

    // The composer keeps saving its text while the user types the next
    // follow-up; its copy of the queue still holds the message just sent.
    sessionDraftsDb.saveDraftText(userId, SESSION_ID, 'typing the next one');

    assert.equal(await dispatchQueuedMessages(createRuntime(runs)), 0);
    assert.deepEqual(runs.map((run) => run.command), ['send me once']);
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

test('scheduled and queued messages stay pending during drain without aborting the active run', async () => {
  await withIsolatedDatabase(async (userId) => {
    scheduledMessagesService.schedule({
      userId, sessionId: SESSION_ID, content: 'after restart',
      scheduledFor: new Date(Date.now() - 1_000).toISOString(),
    });
    sessionDraftsDb.saveDraft(userId, SESSION_ID, {
      text: '', queuedMessage: { content: 'also after restart' },
    });
    const activeRun = chatRunRegistry.startRun({
      appSessionId: SESSION_ID, provider: 'claude', providerSessionId: null,
      connection: null, userId,
    });
    assert.ok(activeRun);
    const drain = chatRunRegistry.drain(1_000);
    const runs: RunCall[] = [];
    const aborts: string[] = [];
    const runtime = createRuntime(runs, 'ok', aborts);
    assert.equal(await dispatchDueScheduledMessages(runtime), 0);
    assert.equal(await dispatchQueuedMessages(runtime), 0);
    const rejected = await runDetachedChatTurn({
      sessionId: SESSION_ID, userId, content: 'not admitted', interruptActiveRun: true,
    }, { runtime });
    assert.equal(rejected.started, false);
    assert.equal(rejected.retryable, true);
    assert.deepEqual(aborts, []);
    assert.deepEqual(runs, []);
    assert.equal(scheduledMessagesDb.listForSession(userId, SESSION_ID)[0].status, 'pending');
    assert.equal(sessionDraftsDb.listQueuedMessages().length, 1);
    chatRunRegistry.completeRunIfCurrent(activeRun, { exitCode: 0 });
    assert.equal(await drain, true);
  });
});

test('drain waits for a started interrupt and restores the schedules waiting behind it', async () => {
  await withIsolatedDatabase(async (userId) => {
    for (const [index, content] of ['accepted before drain', 'retry after restart'].entries()) {
      scheduledMessagesService.schedule({
        userId, sessionId: SESSION_ID, content,
        scheduledFor: new Date(Date.now() - 2_000 + index * 1_000).toISOString(),
      });
    }
    const activeRun = chatRunRegistry.startRun({
      appSessionId: SESSION_ID, provider: 'claude', providerSessionId: null,
      connection: null, userId,
    });
    assert.ok(activeRun);
    let releaseAbort = () => {};
    const abortPending = new Promise<void>((resolve) => { releaseAbort = resolve; });
    let releaseRun = () => {};
    const runPending = new Promise<void>((resolve) => { releaseRun = resolve; });
    const runs: string[] = [];
    const runtime: ProviderRuntimeGateway = {
      ...createRuntime([]),
      abort: async () => { await abortPending; return true; },
      run: async (_provider, command) => { runs.push(command); await runPending; },
    };
    const dispatch = dispatchDueScheduledMessages(runtime);
    releaseAbort();
    await new Promise((resolve) => { setImmediate(resolve); });
    closeScheduledMessageDispatcher();
    let drained = false;
    const drain = chatRunRegistry.drain(1_000).then((result) => { drained = result; return result; });
    try {
      await Promise.resolve();
      assert.equal(drained, false, 'the registered replacement still owns the run');
      const waiting = scheduledMessagesDb.listForSession(userId, SESSION_ID)[1];
      assert.equal(waiting.status, 'pending', 'unstarted claims are durable before drain can finish');
      assert.equal(waiting.failure_reason, null);
      assert.deepEqual(runs, ['accepted before drain']);
      assert.equal(drained, false, 'shutdown still waits for the replacement runtime');
      releaseRun();
      await dispatch;
      assert.equal(await drain, true);
      const rows = scheduledMessagesDb.listForSession(userId, SESSION_ID);
      assert.deepEqual(rows.map((row) => row.status), ['sent', 'pending']);
      assert.ok(rows.every((row) => row.failure_reason === null));
    } finally {
      releaseAbort();
      releaseRun();
      await dispatch;
      await drain;
    }
    // A restarted server admits the unstarted row exactly once.
    chatRunRegistry.clearAll();
    const restartedRuns: RunCall[] = [];
    assert.equal(await dispatchDueScheduledMessages(createRuntime(restartedRuns)), 1);
    assert.equal(restartedRuns[0].command, 'retry after restart');
    assert.equal(scheduledMessagesDb.listForSession(userId, SESSION_ID)[1].status, 'sent');
  });
});

for (const outcome of ['complete', 'reject'] as const) {
  test(`shutdown cancels an unstarted interrupt and ignores its late ${outcome} after another dispatcher reclaims it`, async () => {
    await withIsolatedDatabase(async (userId) => {
      for (const content of ['waiting for abort', 'waiting behind it']) {
        scheduledMessagesService.schedule({
          userId, sessionId: SESSION_ID, content,
          scheduledFor: new Date(Date.now() - 1_000).toISOString(),
        });
      }
      const activeRun = chatRunRegistry.startRun({
        appSessionId: SESSION_ID, provider: 'claude', providerSessionId: null,
        connection: null, userId,
      });
      assert.ok(activeRun);
      let finishAbort = (_value: boolean) => {};
      let failAbort = (_error: Error) => {};
      const abort = new Promise<boolean>((resolve, reject) => { finishAbort = resolve; failAbort = reject; });
      const runs: RunCall[] = [];
      const dispatch = dispatchDueScheduledMessages({ ...createRuntime(runs), abort: () => abort });
      try {
        closeScheduledMessageDispatcher();
        const restored = scheduledMessagesDb.listForSession(userId, SESSION_ID);
        assert.deepEqual(restored.map((row) => row.status), ['pending', 'pending']);
        // Simulate a restarted/overlapping server owning both rows. The old
        // pass must neither start them nor overwrite the new owner's status.
        assert.equal(scheduledMessagesDb.claimDue(new Date()).length, 2);
        chatRunRegistry.completeRunIfCurrent(activeRun, { exitCode: 0 });
        assert.equal(await chatRunRegistry.drain(1_000), true, 'cancelled admission no longer holds shutdown');
        if (outcome === 'complete') {
          finishAbort(true);
        } else {
          failAbort(new Error('late abort failure'));
        }
        await dispatch;
        assert.deepEqual(runs, [], 'a released claim cannot start even with pre-drain admission');
        const reclaimed = scheduledMessagesDb.listForSession(userId, SESSION_ID);
        assert.deepEqual(reclaimed.map((row) => row.status), ['sent', 'sent']);
        assert.ok(reclaimed.every((row) => row.failure_reason === null));
      } finally {
        finishAbort(true);
        await dispatch;
      }
    });
  });
}

test('one claim-release failure does not stop shutdown from releasing the other claims or draining', async (t) => {
  await withIsolatedDatabase(async (userId) => {
    for (const [index, content] of ['running', 'release fails', 'release succeeds'].entries()) {
      scheduledMessagesService.schedule({
        userId, sessionId: SESSION_ID, content,
        scheduledFor: new Date(Date.now() - 3_000 + index * 1_000).toISOString(),
      });
    }
    let release = () => {};
    const held = new Promise<void>((resolve) => { release = resolve; });
    const runtime = { ...createRuntime([]), run: async () => { await held; } };
    const dispatch = dispatchDueScheduledMessages(runtime);
    const rows = scheduledMessagesDb.listForSession(userId, SESSION_ID);
    const originalRelease = scheduledMessagesDb.releaseClaim;
    const failedRow = rows.find((row) => row.content === 'release fails')!;
    const log = t.mock.method(console, 'error', () => {});
    t.mock.method(scheduledMessagesDb, 'releaseClaim', (id: string, token: string | null) => {
      if (id === failedRow.id) {
        throw new Error('database unavailable for this claim');
      }
      originalRelease(id, token);
    });
    try {
      assert.doesNotThrow(closeScheduledMessageDispatcher);
      assert.equal(log.mock.callCount(), 1);
      assert.equal(log.mock.calls[0].arguments[1].id, failedRow.id);
      const afterClose = scheduledMessagesDb.listForSession(userId, SESSION_ID);
      assert.equal(afterClose.find((row) => row.content === 'release succeeds')?.status, 'pending');
      assert.ok(afterClose.find((row) => row.id === failedRow.id)?.dispatch_token, 'failed release retains durable recovery ownership');
      const drain = chatRunRegistry.drain(1_000);
      release();
      await dispatch;
      assert.equal(await drain, true);
    } finally {
      release();
      await dispatch;
      t.mock.restoreAll();
    }
    closeConnection();
    await initializeDatabase();
    chatRunRegistry.clearAll();
    const restartedRuns: RunCall[] = [];
    initializeScheduledMessageDispatcher(createRuntime(restartedRuns));
    // Startup polling is asynchronous; the first provider is entered before
    // its first await, and one event-loop turn lets the complete pass settle.
    await new Promise((resolve) => { setImmediate(resolve); });
    closeScheduledMessageDispatcher();
    assert.deepEqual(restartedRuns.map((run) => run.command), ['release fails', 'release succeeds']);
    assert.ok(scheduledMessagesDb.listForSession(userId, SESSION_ID).every((row) => row.status === 'sent' && row.dispatch_token === null));
  });
});

test('a release error after retryable rejection stays recoverable instead of becoming failed', async (t) => {
  await withIsolatedDatabase(async (userId) => {
    scheduledMessagesService.schedule({
      userId, sessionId: SESSION_ID, content: 'retry after restart',
      scheduledFor: new Date(Date.now() - 1_000).toISOString(),
    });
    const active = chatRunRegistry.startRun({
      appSessionId: SESSION_ID, provider: 'claude', providerSessionId: null, connection: null, userId,
    });
    assert.ok(active);
    const runs: RunCall[] = [];
    const log = t.mock.method(console, 'error', () => {});
    t.mock.method(scheduledMessagesDb, 'releaseClaim', () => { throw new Error('temporary write failure'); });
    try {
      await dispatchDueScheduledMessages({ ...createRuntime(runs), abort: async () => false });
      const row = scheduledMessagesDb.listForSession(userId, SESSION_ID)[0];
      assert.equal(row.status, 'sent');
      assert.equal(row.failure_reason, null, 'restoration failures must not become permanent dispatch failures');
      assert.ok(row.dispatch_token);
      assert.equal(runs.length, 0);
      assert.equal(log.mock.callCount(), 1);
    } finally {
      t.mock.restoreAll();
    }
    closeConnection();
    await initializeDatabase();
    chatRunRegistry.clearAll();
    initializeScheduledMessageDispatcher(createRuntime(runs));
    await new Promise((resolve) => { setImmediate(resolve); });
    closeScheduledMessageDispatcher();
    assert.deepEqual(runs.map((run) => run.command), ['retry after restart']);
    assert.equal(await dispatchDueScheduledMessages(createRuntime(runs)), 0, 'the recovered message is sent once');
  });
});

test('startup recovery fences obsolete owners without replaying started or legacy sent messages', async () => {
  await withIsolatedDatabase(async (userId) => {
    for (const content of ['waiting', 'started', 'legacy']) {
      scheduledMessagesService.schedule({
        userId, sessionId: SESSION_ID, content,
        scheduledFor: new Date(Date.now() - 1_000).toISOString(),
      });
    }
    const claims = scheduledMessagesDb.claimDue(new Date());
    const waiting = claims.find((row) => row.content === 'waiting')!;
    const started = claims.find((row) => row.content === 'started')!;
    const legacy = claims.find((row) => row.content === 'legacy')!;
    assert.equal(scheduledMessagesDb.startClaim(started.id, started.dispatch_token), true);
    getConnection().prepare('UPDATE scheduled_messages SET dispatch_token = NULL WHERE id = ?').run(legacy.id);
    scheduledMessagesDb.recoverUnstartedClaims();
    const [replacement] = scheduledMessagesDb.claimDue(new Date());
    assert.equal(replacement.id, waiting.id);
    assert.notEqual(replacement.dispatch_token, waiting.dispatch_token);
    assert.equal(scheduledMessagesDb.startClaim(waiting.id, waiting.dispatch_token), false);
    scheduledMessagesDb.releaseClaim(waiting.id, waiting.dispatch_token);
    scheduledMessagesDb.markFailed(waiting.id, 'obsolete failure', waiting.dispatch_token);
    const current = scheduledMessagesDb.listForSession(userId, SESSION_ID);
    assert.ok(current.every((row) => row.status === 'sent'));
    assert.equal(current.find((row) => row.id === replacement.id)?.dispatch_token, replacement.dispatch_token);
    assert.equal(scheduledMessagesDb.startClaim(replacement.id, replacement.dispatch_token), true);
  });
});

test('upgrading an existing schedule table preserves historical sent rows', async () => {
  await withIsolatedDatabase(async (userId) => {
    scheduledMessagesService.schedule({
      userId, sessionId: SESSION_ID, content: 'already sent before upgrade',
      scheduledFor: new Date(Date.now() - 1_000).toISOString(),
    });
    await dispatchDueScheduledMessages(createRuntime([]));
    getConnection().exec('ALTER TABLE scheduled_messages DROP COLUMN dispatch_token');
    closeConnection();
    await initializeDatabase();
    await initializeDatabase();
    scheduledMessagesDb.recoverUnstartedClaims();
    const [row] = scheduledMessagesDb.listForSession(userId, SESSION_ID);
    assert.equal(row.status, 'sent');
    assert.equal(row.dispatch_token, null);
    assert.deepEqual(scheduledMessagesDb.claimDue(new Date()), []);
  });
});

test('a failed provider handoff never executes the turn and can recover on restart', async (t) => {
  await withIsolatedDatabase(async (userId) => {
    scheduledMessagesService.schedule({
      userId, sessionId: SESSION_ID, content: 'retry durable handoff',
      scheduledFor: new Date(Date.now() - 1_000).toISOString(),
    });
    const runs: RunCall[] = [];
    t.mock.method(scheduledMessagesDb, 'startClaim', () => { throw new Error('cannot persist start'); });
    t.mock.method(scheduledMessagesDb, 'releaseClaim', () => { throw new Error('cannot persist release'); });
    t.mock.method(console, 'error', () => {});
    try {
      await dispatchDueScheduledMessages(createRuntime(runs));
      assert.equal(runs.length, 0);
      const [row] = scheduledMessagesDb.listForSession(userId, SESSION_ID);
      assert.equal(row.failure_reason, null);
      assert.ok(row.dispatch_token);
      assert.equal(chatRunRegistry.isProcessing(SESSION_ID), false);
    } finally {
      t.mock.restoreAll();
    }
    chatRunRegistry.clearAll();
    initializeScheduledMessageDispatcher(createRuntime(runs));
    await new Promise((resolve) => { setImmediate(resolve); });
    closeScheduledMessageDispatcher();
    assert.deepEqual(runs.map((run) => run.command), ['retry durable handoff']);
  });
});

test('an interrupt revoked by startup recovery cannot send or overwrite the new claim', async () => {
  await withIsolatedDatabase(async (userId) => {
    scheduledMessagesService.schedule({
      userId, sessionId: SESSION_ID, content: 'belongs to replacement',
      scheduledFor: new Date(Date.now() - 1_000).toISOString(),
    });
    const active = chatRunRegistry.startRun({
      appSessionId: SESSION_ID, provider: 'claude', providerSessionId: null, connection: null, userId,
    });
    assert.ok(active);
    let finishAbort = () => {};
    const abort = new Promise<boolean>((resolve) => { finishAbort = () => resolve(true); });
    const runs: RunCall[] = [];
    const dispatch = dispatchDueScheduledMessages({ ...createRuntime(runs), abort: () => abort });
    scheduledMessagesDb.recoverUnstartedClaims();
    const [replacement] = scheduledMessagesDb.claimDue(new Date());
    finishAbort();
    await dispatch;
    assert.deepEqual(runs, []);
    const [current] = scheduledMessagesDb.listForSession(userId, SESSION_ID);
    assert.equal(current.status, 'sent');
    assert.equal(current.dispatch_token, replacement.dispatch_token);
    assert.equal(current.failure_reason, null);
  });
});

test('an unsuccessful interrupt keeps the active provider counted and the schedule retryable', async () => {
  await withIsolatedDatabase(async (userId) => {
    scheduledMessagesService.schedule({
      userId, sessionId: SESSION_ID, content: 'try again',
      scheduledFor: new Date(Date.now() - 1_000).toISOString(),
    });
    const activeRun = chatRunRegistry.startRun({
      appSessionId: SESSION_ID, provider: 'claude', providerSessionId: null,
      connection: null, userId,
    });
    assert.ok(activeRun);
    const runs: RunCall[] = [];
    await dispatchDueScheduledMessages({ ...createRuntime(runs), abort: async () => false });
    assert.deepEqual(runs, []);
    assert.equal(chatRunRegistry.isProcessing(SESSION_ID), true);
    assert.equal(activeRun.events.some((event) => event.kind === 'complete'), false);
    assert.equal(scheduledMessagesDb.listForSession(userId, SESSION_ID)[0].status, 'pending');
    let drained = false;
    const drain = chatRunRegistry.drain(1_000).then((result) => { drained = true; return result; });
    await Promise.resolve();
    assert.equal(drained, false);
    chatRunRegistry.completeRunIfCurrent(activeRun, { exitCode: 0 });
    assert.equal(await drain, true);
  });
});

test('a failed interrupt releases its admission so drain can finish', async () => {
  await withIsolatedDatabase(async (userId) => {
    const activeRun = chatRunRegistry.startRun({
      appSessionId: SESSION_ID, provider: 'claude', providerSessionId: null,
      connection: null, userId,
    });
    assert.ok(activeRun);
    let rejectAbort = (_error: Error) => {};
    const abortPending = new Promise<boolean>((_resolve, reject) => { rejectAbort = reject; });
    const runtime: ProviderRuntimeGateway = {
      ...createRuntime([]),
      abort: () => abortPending,
      run: async () => { throw new Error('a replacement must not start'); },
    };
    const turn = runDetachedChatTurn({
      sessionId: SESSION_ID, userId, content: 'interrupt', interruptActiveRun: true,
    }, { runtime });
    const drain = chatRunRegistry.drain(1_000);
    chatRunRegistry.completeRunIfCurrent(activeRun, { exitCode: 0 });
    rejectAbort(new Error('abort failed'));
    await assert.rejects(turn, /abort failed/);
    assert.equal(await drain, true);
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

// The composer banner is read over REST, so these announcements are the only
// way an open tab learns that its list changed without it doing anything
// (#1546): the banner of a message the timer had already sent stayed up until
// a reload.

test('a due message is announced to open tabs as it is claimed, before its turn runs', async () => {
  await withIsolatedDatabase(async (userId) => {
    scheduledMessagesService.schedule({
      userId,
      sessionId: SESSION_ID,
      content: 'run the nightly checks',
      scheduledFor: new Date(Date.now() - 1_000).toISOString(),
    });
    const tab = openTab();

    let announcedBeforeTheTurn: Array<Record<string, unknown>> = [];
    const runtime = {
      hasRuntime: () => true,
      hasBackgroundWork: () => false,
      run: async () => {
        announcedBeforeTheTurn = tab.announcements();
      },
      abort: async () => true,
    } as never;
    assert.equal(await dispatchDueScheduledMessages(runtime), 1);

    // The banner comes down when the turn starts, not after it finishes,
    // which for a long turn can be many minutes later.
    assert.equal(announcedBeforeTheTurn.length, 1);
    assert.equal(announcedBeforeTheTurn[0].sessionId, SESSION_ID);
    assert.equal(tab.announcements().length, 1);
  });
});

test('a pass announces each session it claimed from once, however many of its messages were due', async () => {
  await withIsolatedDatabase(async (userId) => {
    const otherSessionId = 'other-scheduled-session';
    sessionsDb.createAppSession(otherSessionId, 'claude', tmpdir(), 'Other scheduled session');
    for (const [sessionId, content] of [
      [SESSION_ID, 'first for this session'],
      [SESSION_ID, 'second for this session'],
      [otherSessionId, 'only one for the other session'],
    ]) {
      scheduledMessagesService.schedule({
        userId,
        sessionId,
        content,
        scheduledFor: new Date(Date.now() - 1_000).toISOString(),
      });
    }
    const tab = openTab();

    assert.equal(await dispatchDueScheduledMessages(createRuntime([])), 3);

    // One read per session is enough: a single GET returns all of its rows.
    assert.deepEqual(tab.announcements().map((frame) => frame.sessionId).sort(), [otherSessionId, SESSION_ID]);
  });
});

test('a message that fails to send is announced again once the reason is recorded', async () => {
  await withIsolatedDatabase(async (userId) => {
    scheduledMessagesService.schedule({
      userId,
      sessionId: SESSION_ID,
      content: 'will fail',
      scheduledFor: new Date(Date.now() - 1_000).toISOString(),
    });
    const tab = openTab();

    await dispatchDueScheduledMessages(createRuntime([], 'throw'));

    // Claimed (the banner comes down), then failed (it comes back as the
    // failure notice).
    assert.deepEqual(tab.announcements().map((frame) => frame.sessionId), [SESSION_ID, SESSION_ID]);
    assert.equal(scheduledMessagesDb.listForSession(userId, SESSION_ID)[0].status, 'failed');
  });
});

test('scheduling and cancelling are announced, so other tabs and devices follow', async () => {
  await withIsolatedDatabase(async (userId) => {
    const tab = openTab();

    const scheduled = scheduledMessagesService.schedule({
      userId,
      sessionId: SESSION_ID,
      content: 'from another tab',
      scheduledFor: new Date(Date.now() + 3_600_000).toISOString(),
    });
    assert.equal(tab.announcements().length, 1);

    scheduledMessagesService.cancel(userId, scheduled.id);
    assert.equal(tab.announcements().length, 2);

    // A refused cancel changed nothing, so there is nothing to announce.
    assert.throws(() => scheduledMessagesService.cancel(userId, scheduled.id));
    assert.equal(tab.announcements().length, 2);

    // The frame names the session and nothing else: each tab reads the list
    // again through its own authenticated request.
    for (const frame of tab.announcements()) {
      assert.deepEqual(Object.keys(frame).sort(), ['kind', 'sessionId', 'timestamp']);
      assert.equal(frame.sessionId, SESSION_ID);
    }
  });
});

test('a socket that cannot be written to does not stop a claimed message from being sent', async () => {
  await withIsolatedDatabase(async (userId) => {
    scheduledMessagesService.schedule({
      userId,
      sessionId: SESSION_ID,
      content: 'still goes',
      scheduledFor: new Date(Date.now() - 1_000).toISOString(),
    });
    const closedTab = openTab();
    closedTab.readyState = 3; // CLOSED
    connectedClients.add({
      readyState: 1,
      send: () => {
        throw new Error('socket went away mid-send');
      },
    } as never);

    const runs: RunCall[] = [];
    assert.equal(await dispatchDueScheduledMessages(createRuntime(runs)), 1);

    assert.equal(runs.length, 1);
    assert.equal(runs[0].command, 'still goes');
    assert.equal(closedTab.frames.length, 0);
  });
});
