import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, initializeDatabase, sessionsDb, sideQuestionsDb } from '@/modules/database/index.js';
import { createSideQuestionsService } from '@/modules/providers/services/side-questions.service.js';
import type {
  LLMProvider,
  SideQuestionEvent,
  SideQuestionOutcome,
  SideQuestionRequest,
  SideQuestionRuntime,
  SideQuestionSink,
} from '@/shared/types.js';

const SESSION_ID = 'btw-service-session';

async function withIsolatedDatabase(runTest: (projectPath: string) => void | Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'side-questions-service-'));

  closeConnection();
  process.env.DATABASE_PATH = path.join(tempDirectory, 'auth.db');
  await initializeDatabase();

  try {
    sessionsDb.createAppSession(SESSION_ID, 'claude', tempDirectory, 'BTW service session');
    await runTest(tempDirectory);
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

type RuntimeCall = {
  provider: LLMProvider;
  request: SideQuestionRequest;
  sink: SideQuestionSink;
  resolve: (outcome: SideQuestionOutcome) => void;
};

/**
 * A runtime that hands each call back to the test, so the test streams the
 * deltas through the sink by hand and decides when the outcome resolves.
 */
function createManualRuntime(): { runtime: SideQuestionRuntime; calls: RuntimeCall[]; nextCall: () => Promise<RuntimeCall> } {
  const calls: RuntimeCall[] = [];
  const waiters: Array<() => void> = [];
  let consumed = 0;
  const runtime: SideQuestionRuntime = {
    askSideQuestion: (provider, request, sink) => new Promise<SideQuestionOutcome>((resolve) => {
      calls.push({ provider, request, sink, resolve });
      waiters.splice(0).forEach((wake) => wake());
    }),
  };
  /**
   * The next call the test has not looked at yet, once the service has made it.
   * Bounded, so a service that never reaches the runtime fails here with a
   * message instead of hanging the file until the test timeout.
   */
  const nextCall = async (waitMs = 1000): Promise<RuntimeCall> => {
    const deadline = Date.now() + waitMs;
    while (calls.length <= consumed) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        throw new Error(`the service did not call runtime.askSideQuestion within ${waitMs} ms`);
      }
      let timer: NodeJS.Timeout | undefined;
      await new Promise<void>((resolve) => {
        waiters.push(resolve);
        timer = setTimeout(resolve, remaining);
      });
      clearTimeout(timer);
    }
    return calls[consumed++];
  };
  return { runtime, calls, nextCall };
}

/** Lets the service reach its `await runtime.askSideQuestion(...)`. */
const flush = () => new Promise((resolve) => { setTimeout(resolve, 10); });

function askInput(overrides: Partial<{ sideQuestionId: string; question: string; model: string | null }> = {}, projectPath = '/tmp/project') {
  return {
    sessionId: SESSION_ID,
    provider: 'claude' as LLMProvider,
    providerSessionId: 'provider-native-id',
    projectPath,
    sideQuestionId: overrides.sideQuestionId ?? 'sq-1',
    question: overrides.question ?? 'what does this file do?',
    model: overrides.model === undefined ? 'claude-opus-5' : overrides.model,
  };
}

test('ask persists each delta as it streams, before the outcome resolves', { timeout: 5000 }, async () => {
  await withIsolatedDatabase(async () => {
    const service = createSideQuestionsService();
    const { runtime, nextCall } = createManualRuntime();
    const events: SideQuestionEvent[] = [];

    const asking = service.ask(askInput(), runtime, (event) => events.push(event));
    const call = await nextCall();

    // The row exists and is running before any text arrives.
    assert.equal(sideQuestionsDb.getById('sq-1')?.status, 'running');
    assert.equal(sideQuestionsDb.getById('sq-1')?.answer, '');

    call.sink.delta('Hel');
    assert.equal(sideQuestionsDb.getById('sq-1')?.answer, 'Hel');
    call.sink.delta('lo');
    assert.equal(sideQuestionsDb.getById('sq-1')?.answer, 'Hello');
    assert.equal(sideQuestionsDb.getById('sq-1')?.status, 'running');

    call.resolve({ status: 'done', answer: 'Hello' });
    await asking;

    const row = sideQuestionsDb.getById('sq-1');
    assert.equal(row?.status, 'done');
    assert.equal(row?.answer, 'Hello');
    assert.ok(row?.finished_at);
  });
});

test('ask hands the runtime the session, question, model and a live abort signal', { timeout: 5000 }, async () => {
  await withIsolatedDatabase(async (projectPath) => {
    const service = createSideQuestionsService();
    const { runtime, nextCall } = createManualRuntime();

    const asking = service.ask(askInput({}, projectPath), runtime, () => {});
    const call = await nextCall();

    assert.equal(call.provider, 'claude');
    assert.equal(call.request.appSessionId, SESSION_ID);
    assert.equal(call.request.providerSessionId, 'provider-native-id');
    assert.equal(call.request.projectPath, projectPath);
    assert.equal(call.request.question, 'what does this file do?');
    assert.equal(call.request.model, 'claude-opus-5');
    assert.ok(call.request.signal instanceof AbortSignal);
    assert.equal(call.request.signal.aborted, false);

    call.resolve({ status: 'done', answer: '' });
    await asking;
  });
});

test('ask notifies started, each delta, then done with the whole row, in that order', { timeout: 5000 }, async () => {
  await withIsolatedDatabase(async () => {
    const service = createSideQuestionsService();
    const { runtime, nextCall } = createManualRuntime();
    const events: SideQuestionEvent[] = [];

    const asking = service.ask(askInput(), runtime, (event) => events.push(event));
    const call = await nextCall();

    assert.deepEqual(events.map((event) => event.phase), ['started']);
    assert.equal(events[0].kind, 'side_question');
    assert.equal(events[0].sessionId, SESSION_ID);
    assert.equal(events[0].sideQuestionId, 'sq-1');
    assert.equal(events[0].sideQuestion?.status, 'running');
    assert.equal(events[0].sideQuestion?.question, 'what does this file do?');
    assert.ok(!Number.isNaN(Date.parse(events[0].timestamp)), 'timestamp is ISO');

    call.sink.delta('Hel');
    call.sink.delta('lo');
    assert.deepEqual(events.map((event) => event.phase), ['started', 'delta', 'delta']);
    assert.deepEqual(events.slice(1).map((event) => event.text), ['Hel', 'lo']);

    call.resolve({ status: 'done', answer: 'Hello' });
    await asking;

    assert.deepEqual(events.map((event) => event.phase), ['started', 'delta', 'delta', 'done']);
    const done = events[3];
    assert.equal(done.sideQuestionId, 'sq-1');
    assert.deepEqual(done.sideQuestion, {
      id: 'sq-1',
      sessionId: SESSION_ID,
      question: 'what does this file do?',
      answer: 'Hello',
      status: 'done',
      error: null,
      model: 'claude-opus-5',
      createdAt: done.sideQuestion?.createdAt,
      finishedAt: done.sideQuestion?.finishedAt,
    });
    assert.ok(done.sideQuestion?.createdAt && !Number.isNaN(Date.parse(done.sideQuestion.createdAt)));
    assert.ok(done.sideQuestion?.finishedAt && !Number.isNaN(Date.parse(done.sideQuestion.finishedAt)));
  });
});

test('an error outcome finishes the row as failed and notifies error with the row', { timeout: 5000 }, async () => {
  await withIsolatedDatabase(async () => {
    const service = createSideQuestionsService();
    const { runtime, nextCall } = createManualRuntime();
    const events: SideQuestionEvent[] = [];

    const asking = service.ask(askInput(), runtime, (event) => events.push(event));
    const call = await nextCall();
    call.sink.delta('half');
    call.resolve({ status: 'error', error: 'the fork failed', answer: 'half' });
    await asking;

    const row = sideQuestionsDb.getById('sq-1');
    assert.equal(row?.status, 'error');
    assert.equal(row?.error, 'the fork failed');
    assert.equal(row?.answer, 'half');

    const last = events.at(-1);
    assert.equal(last?.phase, 'error');
    assert.equal(last?.error, 'the fork failed');
    assert.equal(last?.sideQuestion?.status, 'error');
    assert.equal(last?.sideQuestion?.answer, 'half');
    assert.equal(events.filter((event) => event.phase === 'done').length, 0);
  });
});

test('listForSession maps rows to the camelCase shape, oldest first', { timeout: 5000 }, async () => {
  await withIsolatedDatabase(async () => {
    const service = createSideQuestionsService();
    sideQuestionsDb.create({ id: 'sq-a', sessionId: SESSION_ID, question: 'first', model: null });
    await flush();
    sideQuestionsDb.create({ id: 'sq-b', sessionId: SESSION_ID, question: 'second', model: 'claude-opus-5' });
    sideQuestionsDb.finish('sq-b', { status: 'done', answer: 'answered' });

    const list = service.listForSession(SESSION_ID);
    assert.deepEqual(list.map((item) => item.id), ['sq-a', 'sq-b']);
    assert.deepEqual(Object.keys(list[1]).sort(), [
      'answer', 'createdAt', 'error', 'finishedAt', 'id', 'model', 'question', 'sessionId', 'status',
    ]);
    assert.equal(list[0].sessionId, SESSION_ID);
    assert.equal(list[0].status, 'running');
    assert.equal(list[0].finishedAt, null);
    assert.equal(list[1].answer, 'answered');
    assert.equal(list[1].model, 'claude-opus-5');
    assert.ok(list[1].finishedAt);
    assert.deepEqual(service.listForSession('no-such-session'), []);
  });
});

test('dismiss aborts a running side question and deletes its row', { timeout: 5000 }, async () => {
  await withIsolatedDatabase(async () => {
    const service = createSideQuestionsService();
    const { runtime, nextCall } = createManualRuntime();
    const events: SideQuestionEvent[] = [];

    const asking = service.ask(askInput(), runtime, (event) => events.push(event));
    const call = await nextCall();
    call.sink.delta('some');

    assert.equal(service.dismiss(SESSION_ID, 'sq-1'), true);
    assert.equal(call.request.signal.aborted, true);
    assert.equal(sideQuestionsDb.getById('sq-1'), null);

    // The runtime answers an abort with an error outcome; that must not bring the row back.
    call.resolve({ status: 'error', error: 'aborted', answer: 'some' });
    await asking;
    assert.equal(sideQuestionsDb.getById('sq-1'), null);
    assert.deepEqual(service.listForSession(SESSION_ID), []);
  });
});

test('dismiss deletes a finished row and reports false for an unknown one', { timeout: 5000 }, async () => {
  await withIsolatedDatabase(() => {
    const service = createSideQuestionsService();
    sideQuestionsDb.create({ id: 'sq-done', sessionId: SESSION_ID, question: 'q', model: null });
    sideQuestionsDb.finish('sq-done', { status: 'done', answer: 'a' });

    assert.equal(service.dismiss(SESSION_ID, 'sq-done'), true);
    assert.equal(sideQuestionsDb.getById('sq-done'), null);
    assert.equal(service.dismiss(SESSION_ID, 'sq-done'), false);
    assert.equal(service.dismiss(SESSION_ID, 'never-existed'), false);
  });
});

test('dismissing one side question leaves another running one alone', { timeout: 5000 }, async () => {
  await withIsolatedDatabase(async () => {
    const service = createSideQuestionsService();
    const { runtime, calls } = createManualRuntime();

    const first = service.ask(askInput({ sideQuestionId: 'sq-1', question: 'one' }), runtime, () => {});
    const second = service.ask(askInput({ sideQuestionId: 'sq-2', question: 'two' }), runtime, () => {});
    await flush();
    assert.equal(calls.length, 2);
    const callOne = calls.find((call) => call.request.question === 'one')!;
    const callTwo = calls.find((call) => call.request.question === 'two')!;

    assert.equal(service.dismiss(SESSION_ID, 'sq-1'), true);
    assert.equal(callOne.request.signal.aborted, true);
    assert.equal(callTwo.request.signal.aborted, false);

    callOne.resolve({ status: 'error', error: 'aborted', answer: '' });
    callTwo.resolve({ status: 'done', answer: 'still here' });
    await Promise.all([first, second]);
    assert.equal(sideQuestionsDb.getById('sq-2')?.status, 'done');
  });
});

test('recoverInterrupted marks every running row failed with the restart message', { timeout: 5000 }, async () => {
  await withIsolatedDatabase(() => {
    const service = createSideQuestionsService();
    // Rows a dead process left behind: nothing is streaming into them any more.
    sideQuestionsDb.create({ id: 'sq-left-1', sessionId: SESSION_ID, question: 'q', model: null });
    sideQuestionsDb.create({ id: 'sq-left-2', sessionId: SESSION_ID, question: 'q', model: null });
    sideQuestionsDb.create({ id: 'sq-done', sessionId: SESSION_ID, question: 'q', model: null });
    sideQuestionsDb.finish('sq-done', { status: 'done', answer: 'kept' });

    assert.equal(service.recoverInterrupted(), 2);

    for (const id of ['sq-left-1', 'sq-left-2']) {
      const row = sideQuestionsDb.getById(id);
      assert.equal(row?.status, 'error', id);
      assert.equal(row?.error, 'Interrupted: the server restarted before the answer finished.', id);
      assert.ok(row?.finished_at, id);
    }
    assert.equal(sideQuestionsDb.getById('sq-done')?.status, 'done');
    assert.equal(service.recoverInterrupted(), 0);
  });
});
