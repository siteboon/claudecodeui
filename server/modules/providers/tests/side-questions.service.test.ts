import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection } from '@/modules/database/index.js';
// A namespace import, so the one test on the cap constant fails on its own
// while the constant is missing, instead of failing the whole file to load.
import * as sideQuestionsServiceModule from '@/modules/providers/services/side-questions.service.js';
const { createSideQuestionsService } = sideQuestionsServiceModule;

import type {
  LLMProvider,
  SideQuestionEvent,
  SideQuestionOutcome,
  SideQuestionRequest,
  SideQuestionRuntime,
  SideQuestionSink,
} from '@/shared/types.js';

const SESSION_ID = 'side-question-service-session';
const OTHER_SESSION_ID = 'side-question-service-other-session';

/**
 * Side questions live in server memory, not in a table, so every test here
 * runs with no database initialised. DATABASE_PATH still points at an empty
 * temp file: a service that wrongly reaches for the database then fails on a
 * missing table instead of opening the operator's real database.
 */
async function withoutDatabase(runTest: () => void | Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'side-questions-service-'));

  closeConnection();
  process.env.DATABASE_PATH = path.join(tempDirectory, 'never-initialised.db');

  try {
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

function askInput(
  overrides: Partial<{ sessionId: string; sideQuestionId: string; question: string; model: string | null }> = {},
) {
  return {
    sessionId: overrides.sessionId ?? SESSION_ID,
    provider: 'claude' as LLMProvider,
    providerSessionId: 'provider-native-id',
    projectPath: '/tmp/project',
    sideQuestionId: overrides.sideQuestionId ?? 'sq-1',
    question: overrides.question ?? 'what does this file do?',
    model: overrides.model === undefined ? 'claude-opus-5' : overrides.model,
  };
}

/** Asks one question and answers it at once, so it ends up `done`. */
async function askAndFinish(
  service: ReturnType<typeof createSideQuestionsService>,
  input: ReturnType<typeof askInput>,
  answer = 'answered',
): Promise<void> {
  const runtime: SideQuestionRuntime = {
    askSideQuestion: async () => ({ status: 'done', answer }),
  };
  await service.ask(input, runtime, () => {});
}

test('ask keeps each delta in memory as it streams, before the outcome resolves', { timeout: 5000 }, async () => {
  await withoutDatabase(async () => {
    const service = createSideQuestionsService();
    const { runtime, nextCall } = createManualRuntime();

    const asking = service.ask(askInput(), runtime, () => {});
    const call = await nextCall();

    // The question exists and is running before any text arrives.
    assert.equal(service.getById('sq-1')?.status, 'running');
    assert.equal(service.getById('sq-1')?.answer, '');

    call.sink.delta('Hel');
    assert.equal(service.getById('sq-1')?.answer, 'Hel');
    call.sink.delta('lo');
    assert.equal(service.getById('sq-1')?.answer, 'Hello');
    assert.equal(service.getById('sq-1')?.status, 'running');

    call.resolve({ status: 'done', answer: 'Hello' });
    await asking;

    const finished = service.getById('sq-1');
    assert.equal(finished?.status, 'done');
    assert.equal(finished?.answer, 'Hello');
    assert.ok(finished?.finishedAt && !Number.isNaN(Date.parse(finished.finishedAt)));
  });
});

test('getById returns null for an id nobody asked', { timeout: 5000 }, async () => {
  await withoutDatabase(() => {
    const service = createSideQuestionsService();
    assert.equal(service.getById('never-asked'), null);
  });
});

test('ask hands the runtime the session, question, model and a live abort signal', { timeout: 5000 }, async () => {
  await withoutDatabase(async () => {
    const service = createSideQuestionsService();
    const { runtime, nextCall } = createManualRuntime();

    const asking = service.ask(askInput(), runtime, () => {});
    const call = await nextCall();

    assert.equal(call.provider, 'claude');
    assert.equal(call.request.appSessionId, SESSION_ID);
    assert.equal(call.request.providerSessionId, 'provider-native-id');
    assert.equal(call.request.projectPath, '/tmp/project');
    assert.equal(call.request.question, 'what does this file do?');
    assert.equal(call.request.model, 'claude-opus-5');
    assert.ok(call.request.signal instanceof AbortSignal);
    assert.equal(call.request.signal.aborted, false);

    call.resolve({ status: 'done', answer: '' });
    await asking;
  });
});

test('ask notifies started, each delta, then done with the whole side question, in that order', { timeout: 5000 }, async () => {
  await withoutDatabase(async () => {
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

test('an error outcome finishes the side question as failed and notifies error with it', { timeout: 5000 }, async () => {
  await withoutDatabase(async () => {
    const service = createSideQuestionsService();
    const { runtime, nextCall } = createManualRuntime();
    const events: SideQuestionEvent[] = [];

    const asking = service.ask(askInput(), runtime, (event) => events.push(event));
    const call = await nextCall();
    call.sink.delta('half');
    call.resolve({ status: 'error', error: 'the fork failed', answer: 'half' });
    await asking;

    const failed = service.getById('sq-1');
    assert.equal(failed?.status, 'error');
    assert.equal(failed?.error, 'the fork failed');
    assert.equal(failed?.answer, 'half');

    const last = events.at(-1);
    assert.equal(last?.phase, 'error');
    assert.equal(last?.error, 'the fork failed');
    assert.equal(last?.sideQuestion?.status, 'error');
    assert.equal(last?.sideQuestion?.answer, 'half');
    assert.equal(events.filter((event) => event.phase === 'done').length, 0);
  });
});

test('listForSession returns the camelCase shape, oldest first, and only that session', { timeout: 5000 }, async () => {
  await withoutDatabase(async () => {
    const service = createSideQuestionsService();
    const { runtime, nextCall } = createManualRuntime();

    const first = service.ask(askInput({ sideQuestionId: 'sq-a', question: 'first', model: null }), runtime, () => {});
    await nextCall();
    await flush();
    await askAndFinish(service, askInput({ sideQuestionId: 'sq-b', question: 'second' }));
    await askAndFinish(service, askInput({ sessionId: OTHER_SESSION_ID, sideQuestionId: 'sq-other' }));

    const list = service.listForSession(SESSION_ID);
    assert.deepEqual(list.map((item) => item.id), ['sq-a', 'sq-b']);
    assert.deepEqual(Object.keys(list[1]).sort(), [
      'answer', 'createdAt', 'error', 'finishedAt', 'id', 'model', 'question', 'sessionId', 'status',
    ]);
    assert.equal(list[0].sessionId, SESSION_ID);
    assert.equal(list[0].status, 'running');
    assert.equal(list[0].model, null);
    assert.equal(list[0].finishedAt, null);
    assert.equal(list[1].answer, 'answered');
    assert.equal(list[1].model, 'claude-opus-5');
    assert.ok(list[1].finishedAt);
    assert.deepEqual(service.listForSession(OTHER_SESSION_ID).map((item) => item.id), ['sq-other']);
    assert.deepEqual(service.listForSession('no-such-session'), []);

    service.dismiss(SESSION_ID, 'sq-a');
    await first;
  });
});

test('a second service instance starts empty, as after a CloudCLI restart', { timeout: 5000 }, async () => {
  await withoutDatabase(async () => {
    const before = createSideQuestionsService();
    await askAndFinish(before, askInput());
    assert.equal(before.getById('sq-1')?.status, 'done');

    const after = createSideQuestionsService();
    assert.equal(after.getById('sq-1'), null);
    assert.deepEqual(after.listForSession(SESSION_ID), []);
    assert.equal(after.dismiss(SESSION_ID, 'sq-1'), false);
  });
});

test('dismiss aborts a running side question and deletes it', { timeout: 5000 }, async () => {
  await withoutDatabase(async () => {
    const service = createSideQuestionsService();
    const { runtime, nextCall } = createManualRuntime();

    const asking = service.ask(askInput(), runtime, () => {});
    const call = await nextCall();
    call.sink.delta('some');

    assert.equal(service.dismiss(SESSION_ID, 'sq-1', () => {}), true);
    assert.equal(call.request.signal.aborted, true);
    assert.equal(service.getById('sq-1'), null);

    // The runtime answers an abort with an error outcome; that must not bring it back.
    call.resolve({ status: 'error', error: 'aborted', answer: 'some' });
    await asking;
    assert.equal(service.getById('sq-1'), null);
    assert.deepEqual(service.listForSession(SESSION_ID), []);
  });
});

test('dismiss deletes a finished side question and reports false for an unknown one', { timeout: 5000 }, async () => {
  await withoutDatabase(async () => {
    const service = createSideQuestionsService();
    await askAndFinish(service, askInput({ sideQuestionId: 'sq-done' }));

    assert.equal(service.dismiss(SESSION_ID, 'sq-done', () => {}), true);
    assert.equal(service.getById('sq-done'), null);
    assert.equal(service.dismiss(SESSION_ID, 'sq-done', () => {}), false);
    assert.equal(service.dismiss(SESSION_ID, 'never-existed', () => {}), false);
  });
});

test('dismissing one side question leaves another running one alone', { timeout: 5000 }, async () => {
  await withoutDatabase(async () => {
    const service = createSideQuestionsService();
    const { runtime, calls } = createManualRuntime();

    const first = service.ask(askInput({ sideQuestionId: 'sq-1', question: 'one' }), runtime, () => {});
    const second = service.ask(askInput({ sideQuestionId: 'sq-2', question: 'two' }), runtime, () => {});
    await flush();
    assert.equal(calls.length, 2);
    const callOne = calls.find((call) => call.request.question === 'one')!;
    const callTwo = calls.find((call) => call.request.question === 'two')!;

    assert.equal(service.dismiss(SESSION_ID, 'sq-1', () => {}), true);
    assert.equal(callOne.request.signal.aborted, true);
    assert.equal(callTwo.request.signal.aborted, false);

    callOne.resolve({ status: 'error', error: 'aborted', answer: '' });
    callTwo.resolve({ status: 'done', answer: 'still here' });
    await Promise.all([first, second]);
    assert.equal(service.getById('sq-2')?.status, 'done');
  });
});

test('the default per-session cap is 50', () => {
  assert.equal(sideQuestionsServiceModule.MAX_SIDE_QUESTIONS_PER_SESSION, 50);
});

test('past the cap, the session\'s oldest running question is aborted, dismissed and notified first', { timeout: 5000 }, async () => {
  await withoutDatabase(async () => {
    const service = createSideQuestionsService({ maxPerSession: 2 });
    const { runtime, calls, nextCall } = createManualRuntime();

    // The other session's question is the oldest in the whole service, so
    // only an eviction scoped to the asking session leaves it alone.
    const elsewhere = service.ask(
      askInput({ sessionId: OTHER_SESSION_ID, sideQuestionId: 'sq-other', question: 'other' }),
      runtime,
      () => {},
    );
    await nextCall();
    await flush();
    const oldest = service.ask(askInput({ sideQuestionId: 'sq-1', question: 'one' }), runtime, () => {});
    await nextCall();
    await flush();
    const middle = service.ask(askInput({ sideQuestionId: 'sq-2', question: 'two' }), runtime, () => {});
    await nextCall();

    const events: SideQuestionEvent[] = [];
    const newest = service.ask(askInput({ sideQuestionId: 'sq-3', question: 'three' }), runtime, (event) => events.push(event));
    await nextCall();

    const callOne = calls.find((call) => call.request.question === 'one')!;
    const callTwo = calls.find((call) => call.request.question === 'two')!;
    const callOther = calls.find((call) => call.request.question === 'other')!;
    assert.equal(callOne.request.signal.aborted, true, 'the evicted question\'s runtime call is aborted');
    assert.equal(callTwo.request.signal.aborted, false);
    assert.equal(callOther.request.signal.aborted, false);

    assert.equal(service.getById('sq-1'), null);
    assert.deepEqual(service.listForSession(SESSION_ID).map((item) => item.id), ['sq-2', 'sq-3']);
    assert.deepEqual(service.listForSession(OTHER_SESSION_ID).map((item) => item.id), ['sq-other']);

    const dismissed = events.filter((event) => event.phase === 'dismissed');
    assert.deepEqual(dismissed.map((event) => [event.sessionId, event.sideQuestionId]), [[SESSION_ID, 'sq-1']]);
    assert.ok(
      events.findIndex((event) => event.phase === 'dismissed')
        < events.findIndex((event) => event.phase === 'started' && event.sideQuestionId === 'sq-3'),
      'the oldest is dismissed before the new one starts',
    );

    // The aborted call settling late must not bring the evicted question back.
    callOne.resolve({ status: 'error', error: 'aborted', answer: '' });
    for (const call of calls.filter((entry) => entry !== callOne)) {
      call.resolve({ status: 'done', answer: 'ok' });
    }
    await Promise.all([oldest, middle, elsewhere, newest]);
    assert.equal(service.getById('sq-1'), null);
    assert.deepEqual(service.listForSession(SESSION_ID).map((item) => item.id), ['sq-2', 'sq-3']);
  });
});

test('past the cap, a finished oldest question is dismissed too, whatever its status', { timeout: 5000 }, async () => {
  await withoutDatabase(async () => {
    const service = createSideQuestionsService({ maxPerSession: 2 });
    // Oldest in the whole service, but in another session: it must stay.
    await askAndFinish(service, askInput({ sessionId: OTHER_SESSION_ID, sideQuestionId: 'sq-other' }));
    await flush();
    await askAndFinish(service, askInput({ sideQuestionId: 'sq-1' }));
    await flush();
    await askAndFinish(service, askInput({ sideQuestionId: 'sq-2' }));

    const events: SideQuestionEvent[] = [];
    const runtime: SideQuestionRuntime = { askSideQuestion: async () => ({ status: 'done', answer: 'new' }) };
    await service.ask(askInput({ sideQuestionId: 'sq-3' }), runtime, (event) => events.push(event));

    assert.equal(service.getById('sq-1'), null);
    assert.deepEqual(service.listForSession(SESSION_ID).map((item) => item.id), ['sq-2', 'sq-3']);
    assert.deepEqual(service.listForSession(OTHER_SESSION_ID).map((item) => item.id), ['sq-other']);
    assert.deepEqual(
      events.filter((event) => event.phase === 'dismissed').map((event) => event.sideQuestionId),
      ['sq-1'],
    );
  });
});

test('the service has no recoverInterrupted: nothing outlives a restart', () => {
  const service = createSideQuestionsService() as Record<string, unknown>;
  assert.equal(service.recoverInterrupted, undefined);
});
