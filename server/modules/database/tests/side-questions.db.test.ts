import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, initializeDatabase, sessionsDb, sideQuestionsDb } from '@/modules/database/index.js';
import type { SideQuestionRow } from '@/modules/database/index.js';

const SESSION_ID = 'btw-session';
const OTHER_SESSION_ID = 'btw-other-session';

async function withIsolatedDatabase(runTest: () => void | Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'side-questions-db-'));

  closeConnection();
  process.env.DATABASE_PATH = path.join(tempDirectory, 'auth.db');
  await initializeDatabase();

  try {
    sessionsDb.createAppSession(SESSION_ID, 'claude', tempDirectory, 'BTW session');
    sessionsDb.createAppSession(OTHER_SESSION_ID, 'claude', tempDirectory, 'Other session');
    await runTest();
  } finally {
    closeConnection();
    if (previousDatabasePath === undefined) {
      delete process.env.DATABASE_PATH;
    } else {
      process.env.DATABASE_PATH = previousDatabasePath;
    }
    await rm(tempDirectory, { recursive: true, force: true });
  }
}

/** Distinct, ordered creation times without depending on the clock's resolution. */
const tick = () => new Promise((resolve) => { setTimeout(resolve, 5); });

test('create stores a running row with an empty answer and a creation time', { timeout: 5000 }, async () => {
  await withIsolatedDatabase(() => {
    const before = Date.now();
    const row: SideQuestionRow = sideQuestionsDb.create({
      id: 'sq-1',
      sessionId: SESSION_ID,
      question: 'what does this file do?',
      model: 'claude-opus-5',
    });

    assert.equal(row.id, 'sq-1');
    assert.equal(row.session_id, SESSION_ID);
    assert.equal(row.question, 'what does this file do?');
    assert.equal(row.answer, '');
    assert.equal(row.status, 'running');
    assert.equal(row.error, null);
    assert.equal(row.model, 'claude-opus-5');
    assert.equal(row.finished_at, null);
    assert.ok(Date.parse(row.created_at) >= before - 1000, 'created_at is an ISO time of now');

    assert.deepEqual(sideQuestionsDb.getById('sq-1'), row);
  });
});

test('create keeps a missing model as null', { timeout: 5000 }, async () => {
  await withIsolatedDatabase(() => {
    const row = sideQuestionsDb.create({ id: 'sq-null-model', sessionId: SESSION_ID, question: 'q', model: null });
    assert.equal(row.model, null);
  });
});

test('getById returns null for an id that does not exist', { timeout: 5000 }, async () => {
  await withIsolatedDatabase(() => {
    assert.equal(sideQuestionsDb.getById('nope'), null);
  });
});

test('appendAnswer grows the stored answer piece by piece', { timeout: 5000 }, async () => {
  await withIsolatedDatabase(() => {
    sideQuestionsDb.create({ id: 'sq-1', sessionId: SESSION_ID, question: 'q', model: null });

    sideQuestionsDb.appendAnswer('sq-1', 'Hel');
    assert.equal(sideQuestionsDb.getById('sq-1')?.answer, 'Hel');
    sideQuestionsDb.appendAnswer('sq-1', 'lo');
    assert.equal(sideQuestionsDb.getById('sq-1')?.answer, 'Hello');
    assert.equal(sideQuestionsDb.getById('sq-1')?.status, 'running');
  });
});

test('finish with done replaces the answer with the whole text and sets finished_at', { timeout: 5000 }, async () => {
  await withIsolatedDatabase(() => {
    sideQuestionsDb.create({ id: 'sq-1', sessionId: SESSION_ID, question: 'q', model: null });
    sideQuestionsDb.appendAnswer('sq-1', 'partial');

    sideQuestionsDb.finish('sq-1', { status: 'done', answer: 'the whole answer' });

    const row = sideQuestionsDb.getById('sq-1');
    assert.equal(row?.status, 'done');
    assert.equal(row?.answer, 'the whole answer');
    assert.equal(row?.error, null);
    assert.ok(row?.finished_at && !Number.isNaN(Date.parse(row.finished_at)), 'finished_at is an ISO time');
  });
});

test('finish with error stores the message and the partial answer', { timeout: 5000 }, async () => {
  await withIsolatedDatabase(() => {
    sideQuestionsDb.create({ id: 'sq-1', sessionId: SESSION_ID, question: 'q', model: null });

    sideQuestionsDb.finish('sq-1', { status: 'error', answer: 'half', error: 'the fork failed' });

    const row = sideQuestionsDb.getById('sq-1');
    assert.equal(row?.status, 'error');
    assert.equal(row?.answer, 'half');
    assert.equal(row?.error, 'the fork failed');
    assert.ok(row?.finished_at);
  });
});

test('listForSession returns only that session\'s rows, oldest first', { timeout: 5000 }, async () => {
  await withIsolatedDatabase(async () => {
    sideQuestionsDb.create({ id: 'sq-a', sessionId: SESSION_ID, question: 'first', model: null });
    await tick();
    sideQuestionsDb.create({ id: 'sq-other', sessionId: OTHER_SESSION_ID, question: 'elsewhere', model: null });
    await tick();
    sideQuestionsDb.create({ id: 'sq-b', sessionId: SESSION_ID, question: 'second', model: null });
    await tick();
    sideQuestionsDb.create({ id: 'sq-c', sessionId: SESSION_ID, question: 'third', model: null });

    assert.deepEqual(sideQuestionsDb.listForSession(SESSION_ID).map((row) => row.id), ['sq-a', 'sq-b', 'sq-c']);
    assert.deepEqual(sideQuestionsDb.listForSession(OTHER_SESSION_ID).map((row) => row.id), ['sq-other']);
    assert.deepEqual(sideQuestionsDb.listForSession('no-such-session'), []);
  });
});

test('delete removes a row of that session and reports whether one went', { timeout: 5000 }, async () => {
  await withIsolatedDatabase(() => {
    sideQuestionsDb.create({ id: 'sq-1', sessionId: SESSION_ID, question: 'q', model: null });

    // Scoped to the session: the right id under the wrong session deletes nothing.
    assert.equal(sideQuestionsDb.delete(OTHER_SESSION_ID, 'sq-1'), false);
    assert.ok(sideQuestionsDb.getById('sq-1'));

    assert.equal(sideQuestionsDb.delete(SESSION_ID, 'sq-1'), true);
    assert.equal(sideQuestionsDb.getById('sq-1'), null);
    assert.equal(sideQuestionsDb.delete(SESSION_ID, 'sq-1'), false);
  });
});

test('deleting the session cascades to its side questions', { timeout: 5000 }, async () => {
  await withIsolatedDatabase(() => {
    sideQuestionsDb.create({ id: 'sq-1', sessionId: SESSION_ID, question: 'q', model: null });
    sideQuestionsDb.create({ id: 'sq-2', sessionId: OTHER_SESSION_ID, question: 'q', model: null });

    assert.equal(sessionsDb.deleteSessionById(SESSION_ID), true);

    assert.equal(sideQuestionsDb.getById('sq-1'), null);
    assert.deepEqual(sideQuestionsDb.listForSession(SESSION_ID), []);
    assert.ok(sideQuestionsDb.getById('sq-2'), 'another session\'s row survives');
  });
});

test('failRunning turns every running row into an error and leaves finished rows alone', { timeout: 5000 }, async () => {
  await withIsolatedDatabase(() => {
    sideQuestionsDb.create({ id: 'sq-running-1', sessionId: SESSION_ID, question: 'q', model: null });
    sideQuestionsDb.appendAnswer('sq-running-1', 'half an answer');
    sideQuestionsDb.create({ id: 'sq-running-2', sessionId: OTHER_SESSION_ID, question: 'q', model: null });
    sideQuestionsDb.create({ id: 'sq-done', sessionId: SESSION_ID, question: 'q', model: null });
    sideQuestionsDb.finish('sq-done', { status: 'done', answer: 'kept' });

    assert.equal(sideQuestionsDb.failRunning('server restarted'), 2);

    for (const id of ['sq-running-1', 'sq-running-2']) {
      const row = sideQuestionsDb.getById(id);
      assert.equal(row?.status, 'error', id);
      assert.equal(row?.error, 'server restarted', id);
      assert.ok(row?.finished_at, `${id} has finished_at`);
    }
    // The partial answer stays readable after the failure.
    assert.equal(sideQuestionsDb.getById('sq-running-1')?.answer, 'half an answer');

    const done = sideQuestionsDb.getById('sq-done');
    assert.equal(done?.status, 'done');
    assert.equal(done?.answer, 'kept');
    assert.equal(done?.error, null);

    assert.equal(sideQuestionsDb.failRunning('again'), 0);
  });
});

test('the table survives a second initializeDatabase on the same file', { timeout: 5000 }, async () => {
  await withIsolatedDatabase(async () => {
    sideQuestionsDb.create({ id: 'sq-1', sessionId: SESSION_ID, question: 'q', model: null });

    closeConnection();
    await initializeDatabase();

    assert.equal(sideQuestionsDb.getById('sq-1')?.question, 'q');
  });
});
