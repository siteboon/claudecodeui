import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, initializeDatabase, scheduledMessagesDb, sessionsDb, userDb } from '@/modules/database/index.js';
import { createUsageLimitWatcher, scheduleUsageLimitContinue } from '@/modules/providers/list/claude/claude-runtime.provider.js';

const NOW = Date.parse('2026-10-22T15:00:00Z');
const RESET_SECONDS = Date.parse('2026-10-22T16:10:00Z') / 1000;

async function withDatabase(runTest: (userId: number, continueAt: Date) => void | Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'usage-limit-'));
  closeConnection();
  process.env.DATABASE_PATH = path.join(tempDirectory, 'auth.db');
  await initializeDatabase();
  try {
    const userId = Number(userDb.createUser('limited', 'hash').id);
    sessionsDb.createAppSession('limited-session', 'claude', tempDirectory, 'Limited');
    sessionsDb.setSessionAutoContinue('limited-session', true);
    await runTest(userId, new Date(NOW + 3_600_000));
  } finally {
    closeConnection();
    if (previousDatabasePath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previousDatabasePath;
    await rm(tempDirectory, { recursive: true, force: true });
  }
}

const rejected = (resetsAt: number) => ({
  type: 'rate_limit_event',
  rate_limit_info: { status: 'rejected', resetsAt },
});
// The shape Claude Code writes when a turn is stopped by the limit.
const limitHit = {
  type: 'assistant',
  error: 'rate_limit',
  message: { model: '<synthetic>', content: [{ type: 'text', text: "You've hit your session limit · resets 6:10pm (Europe/Berlin)" }] },
};

test('a turn blocked by the usage limit continues a minute after the reset', () => {
  const watch = createUsageLimitWatcher();
  assert.equal(watch(rejected(RESET_SECONDS), NOW), null);
  assert.equal(watch(limitHit, NOW)?.toISOString(), '2026-10-22T16:11:00.000Z');
});

test('a reset time given in milliseconds is read the same', () => {
  const watch = createUsageLimitWatcher();
  watch(rejected(RESET_SECONDS * 1000), NOW);
  assert.equal(watch(limitHit, NOW)?.toISOString(), '2026-10-22T16:11:00.000Z');
});

test('a limit hit is answered only once', () => {
  const watch = createUsageLimitWatcher();
  watch(rejected(RESET_SECONDS), NOW);
  watch(limitHit, NOW);
  assert.equal(watch(limitHit, NOW), null);
});

test('nothing is scheduled without a known reset time', () => {
  // An API-key 429 has no subscription reset to wait for.
  assert.equal(createUsageLimitWatcher()(limitHit, NOW), null);
});

test('a reset already in the past schedules nothing', () => {
  // Otherwise a stale reset would re-send "continue" into the limit every poll.
  const watch = createUsageLimitWatcher();
  watch(rejected(NOW / 1000 - 60), NOW);
  assert.equal(watch(limitHit, NOW), null);
});

test('a warning that still allows the turn schedules nothing', () => {
  const watch = createUsageLimitWatcher();
  watch({ type: 'rate_limit_event', rate_limit_info: { status: 'allowed_warning', resetsAt: RESET_SECONDS } }, NOW);
  assert.equal(watch(limitHit, NOW), null);
});

test('the limit message may arrive before the reset time', () => {
  // The SDK does not promise which of the two comes first.
  const watch = createUsageLimitWatcher();
  assert.equal(watch(limitHit, NOW), null);
  assert.equal(watch(rejected(RESET_SECONDS), NOW)?.toISOString(), '2026-10-22T16:11:00.000Z');
});

test('a limit that resets more than a day away schedules nothing', () => {
  // A weekly limit: a "continue" days later would land in a conversation long moved on.
  const watch = createUsageLimitWatcher();
  watch(rejected(NOW / 1000 + 25 * 3600), NOW);
  assert.equal(watch(limitHit, NOW), null);
});

test('a stop that was not answered does not carry over to a later reset time', () => {
  const watch = createUsageLimitWatcher();
  watch(rejected(NOW / 1000 + 25 * 3600), NOW);
  watch(limitHit, NOW);
  assert.equal(watch(rejected(RESET_SECONDS), NOW), null);
});

test('a stop left unanswered at the end of the turn does not carry into the next', () => {
  const watch = createUsageLimitWatcher();
  watch(limitHit, NOW);
  watch({ type: 'result', is_error: true }, NOW);
  assert.equal(watch(rejected(RESET_SECONDS), NOW), null);
});

test('a later event that allows requests again forgets the reset time', () => {
  const watch = createUsageLimitWatcher();
  watch(rejected(RESET_SECONDS), NOW);
  watch({ type: 'rate_limit_event', rate_limit_info: { status: 'allowed', resetsAt: RESET_SECONDS } }, NOW);
  assert.equal(watch(limitHit, NOW), null);
});

test('an event about another limit window keeps the reset time of the one that stopped the turn', () => {
  const watch = createUsageLimitWatcher();
  watch({ type: 'rate_limit_event', rate_limit_info: { status: 'rejected', resetsAt: RESET_SECONDS, rateLimitType: 'five_hour' } }, NOW);
  watch({ type: 'rate_limit_event', rate_limit_info: { status: 'allowed_warning', resetsAt: RESET_SECONDS + 86_400, rateLimitType: 'seven_day' } }, NOW);
  assert.equal(watch(limitHit, NOW)?.toISOString(), '2026-10-22T16:11:00.000Z');
});

test('when two windows reject, the continue waits for the later reset', () => {
  // Continuing at the earlier one would run straight into the other limit.
  const watch = createUsageLimitWatcher();
  watch({ type: 'rate_limit_event', rate_limit_info: { status: 'rejected', resetsAt: RESET_SECONDS + 3600, rateLimitType: 'seven_day_opus' } }, NOW);
  watch({ type: 'rate_limit_event', rate_limit_info: { status: 'rejected', resetsAt: RESET_SECONDS, rateLimitType: 'five_hour' } }, NOW);
  assert.equal(watch(limitHit, NOW)?.toISOString(), '2026-10-22T17:11:00.000Z');
});

test('a window that stops rejecting leaves the other rejected window in charge', () => {
  const watch = createUsageLimitWatcher();
  watch({ type: 'rate_limit_event', rate_limit_info: { status: 'rejected', resetsAt: RESET_SECONDS, rateLimitType: 'five_hour' } }, NOW);
  watch({ type: 'rate_limit_event', rate_limit_info: { status: 'rejected', resetsAt: RESET_SECONDS + 3600, rateLimitType: 'seven_day_opus' } }, NOW);
  watch({ type: 'rate_limit_event', rate_limit_info: { status: 'allowed', rateLimitType: 'seven_day_opus' } }, NOW);
  assert.equal(watch(limitHit, NOW)?.toISOString(), '2026-10-22T16:11:00.000Z');
});

test('a corrected reset time for the same window replaces the earlier one', () => {
  const watch = createUsageLimitWatcher();
  watch(rejected(RESET_SECONDS + 3600), NOW);
  watch(rejected(RESET_SECONDS), NOW);
  assert.equal(watch(limitHit, NOW)?.toISOString(), '2026-10-22T16:11:00.000Z');
});

test('a subagent stopped by the limit does not schedule for the session', () => {
  const watch = createUsageLimitWatcher();
  watch(rejected(RESET_SECONDS), NOW);
  assert.equal(watch({ ...limitHit, parent_tool_use_id: 'toolu_1' }, NOW), null);
});

test('nothing is scheduled unless the session has auto-continue turned on', async () => {
  await withDatabase(async (userId, at) => {
    sessionsDb.setSessionAutoContinue('limited-session', false);
    scheduleUsageLimitContinue({ userId, sessionId: 'limited-session', runOptions: {}, continueAt: at });
    assert.equal(scheduledMessagesDb.listForSession(userId, 'limited-session').length, 0);
  });
});

test('a "continue" the user scheduled themselves does not stand in for the automatic one', async () => {
  await withDatabase(async (userId, at) => {
    scheduledMessagesDb.create({ userId, sessionId: 'limited-session', content: 'continue', options: {}, scheduledFor: new Date(NOW + 86_400_000) });
    scheduleUsageLimitContinue({ userId, sessionId: 'limited-session', runOptions: {}, continueAt: at });
    assert.equal(scheduledMessagesDb.listForSession(userId, 'limited-session').length, 2);
  });
});

test('the continue keeps the stopped turn\'s model, effort and permission mode only', async () => {
  // Tool permissions are read when it fires, so ones revoked since do not run unattended.
  await withDatabase(async (userId, at) => {
    const toolsSettings = { allowedTools: ['Bash'], disallowedTools: [], skipPermissions: true };
    scheduleUsageLimitContinue({
      userId,
      sessionId: 'limited-session',
      runOptions: { model: 'opus', effort: 'high', permissionMode: 'acceptEdits', toolsSettings, images: [{ path: 'x' }], cwd: '/tmp' },
      continueAt: at,
    });
    const [row] = scheduledMessagesDb.listForSession(userId, 'limited-session');
    assert.deepEqual(JSON.parse(row.options), {
      model: 'opus', effort: 'high', permissionMode: 'acceptEdits', autoContinue: true,
    });
  });
});

test('a second limit hit replaces the waiting "continue" instead of adding one', async () => {
  // Due together, each would interrupt the run the previous one started.
  await withDatabase(async (userId, at) => {
    scheduleUsageLimitContinue({ userId, sessionId: 'limited-session', runOptions: { model: 'opus' }, continueAt: at });
    scheduleUsageLimitContinue({ userId, sessionId: 'limited-session', runOptions: { model: 'sonnet' }, continueAt: at });
    const pending = scheduledMessagesDb.listForSession(userId, 'limited-session').filter((row) => row.status === 'pending');
    assert.deepEqual(
      pending.map((row) => [row.content, JSON.parse(row.options)]),
      [['continue', { model: 'sonnet', autoContinue: true }]],
    );
  });
});

test('a new turn drops the waiting automatic "continue" only', async () => {
  // The user came back before the reset fired it; the conversation has moved on.
  await withDatabase(async (userId, at) => {
    scheduledMessagesDb.create({ userId, sessionId: 'limited-session', content: 'mine', options: {}, scheduledFor: at });
    scheduleUsageLimitContinue({ userId, sessionId: 'limited-session', runOptions: {}, continueAt: at });
    // The count tells the caller whether there is a change to announce.
    assert.equal(scheduledMessagesDb.cancelPendingAutoContinue('limited-session'), 1);
    assert.equal(scheduledMessagesDb.cancelPendingAutoContinue('limited-session'), 0);
    const rows = scheduledMessagesDb.listForSession(userId, 'limited-session');
    assert.deepEqual(rows.map((row) => [row.content, row.status]).sort(), [['continue', 'cancelled'], ['mine', 'pending']]);
  });
});
