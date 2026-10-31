import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, initializeDatabase, sessionsDb } from '@/modules/database/index.js';
import { sideQuestionsService } from '@/modules/providers/index.js';
import { handleChatConnection } from '@/modules/websocket/services/chat-websocket.service.js';
import { chatRunRegistry } from '@/modules/websocket/services/chat-run-registry.service.js';
import { connectedClients } from '@/modules/websocket/services/websocket-state.service.js';
import type { SideQuestionOutcome, SideQuestionRequest, SideQuestionSink } from '@/shared/types.js';

const SESSION_ID = 'side-question-socket-session';
// Cursor has no headless side question (`supportsSideQuestions: false`).
const CURSOR_SESSION_ID = 'side-question-socket-cursor-session';
// Codex and opencode answer their own side questions, like Claude.
const CODEX_SESSION_ID = 'side-question-socket-codex-session';
const OPENCODE_SESSION_ID = 'side-question-socket-opencode-session';
const PROVIDER_SESSION_ID = 'claude-native-id';

type Frame = Record<string, unknown>;

function createFakeSocket() {
  const socket = new EventEmitter() as EventEmitter & {
    readyState: number;
    frames: Frame[];
    send: (data: string) => void;
  };
  socket.readyState = 1;
  socket.frames = [];
  socket.send = (data: string) => socket.frames.push(JSON.parse(data) as Frame);
  return socket;
}

type FakeSocket = ReturnType<typeof createFakeSocket>;

type AskCall = {
  provider: string;
  request: SideQuestionRequest;
  sink: SideQuestionSink;
  resolve: (outcome: SideQuestionOutcome) => void;
};

type RunCall = { provider: string; command: string; options: Record<string, unknown> };

/**
 * Two connected chat clients on one gateway: `asker` sends the frames,
 * `watcher` is another tab that only listens. The runtime's side-question
 * calls stay pending until the test resolves them, and its turns never end,
 * so a run started here is still registered when the test inspects it.
 *
 * Every `abort` and `stopBackgroundTask` call is recorded, and each test ends
 * by asserting there were none: a side question must stop nothing.
 */
async function withGateway(
  runTest: (context: {
    asker: FakeSocket;
    watcher: FakeSocket;
    asks: AskCall[];
    runs: RunCall[];
    projectPath: string;
  }) => Promise<void>,
  options: { backgroundWork?: boolean } = {},
): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'chat-side-question-'));

  closeConnection();
  process.env.DATABASE_PATH = path.join(tempDirectory, 'auth.db');
  await initializeDatabase();

  const asks: AskCall[] = [];
  const runs: RunCall[] = [];
  const stopCalls: Array<{ method: 'abort' | 'stopBackgroundTask'; args: unknown[] }> = [];
  const asker = createFakeSocket();
  const watcher = createFakeSocket();

  try {
    sessionsDb.createAppSession(SESSION_ID, 'claude', tempDirectory, 'Side question socket session');
    sessionsDb.createAppSession(CURSOR_SESSION_ID, 'cursor', tempDirectory, 'Cursor side question session');
    sessionsDb.createAppSession(CODEX_SESSION_ID, 'codex', tempDirectory, 'Codex side question session');
    sessionsDb.createAppSession(OPENCODE_SESSION_ID, 'opencode', tempDirectory, 'opencode side question session');
    sessionsDb.assignProviderSessionId(SESSION_ID, PROVIDER_SESSION_ID);

    const runtime = {
      // Every provider has a runtime for turns; only the capability decides
      // whether a side question is accepted.
      hasRuntime: (provider: string) => ['claude', 'codex', 'cursor', 'opencode'].includes(provider),
      hasBackgroundWork: () => options.backgroundWork === true,
      run: (provider: string, command: string, options: Record<string, unknown>) => {
        runs.push({ provider, command, options });
        return new Promise(() => {});
      },
      abort: async (...args: unknown[]) => {
        stopCalls.push({ method: 'abort', args });
        return true;
      },
      stopBackgroundTask: async (...args: unknown[]) => {
        stopCalls.push({ method: 'stopBackgroundTask', args });
        return false;
      },
      resolveToolApproval: () => {},
      getPendingApprovalsForSession: () => [],
      askSideQuestion: (provider: string, request: SideQuestionRequest, sink: SideQuestionSink) =>
        new Promise<SideQuestionOutcome>((resolve) => {
          asks.push({ provider, request, sink, resolve });
        }),
    };

    for (const socket of [asker, watcher]) {
      handleChatConnection(socket as never, { user: { id: 1 } } as never, { runtime: runtime as never });
    }

    await runTest({ asker, watcher, asks, runs, projectPath: tempDirectory });
    await settle();
    assert.deepEqual(stopCalls, [], 'a side question stops no turn and no background task');
  } finally {
    // Unblock anything still waiting so no promise outlives the database.
    for (const ask of asks) {
      ask.resolve({ status: 'error', error: 'test ended', answer: '' });
    }
    await settle();
    connectedClients.clear();
    chatRunRegistry.clearAll();
    try {
      // The handler uses the process-wide service, whose memory outlives one
      // test; clear it so an id reused by the next test is not a duplicate.
      for (const sessionId of [SESSION_ID, CURSOR_SESSION_ID, CODEX_SESSION_ID, OPENCODE_SESSION_ID, 'no-such-session']) {
        for (const sideQuestion of sideQuestionsService.listForSession(sessionId)) {
          sideQuestionsService.dismiss(sessionId, sideQuestion.id, () => {});
        }
      }
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
}

/** The handler is async and the socket listener does not await it. */
const settle = () => new Promise((resolve) => { setTimeout(resolve, 30); });

function sendSideQuestion(socket: FakeSocket, frame: Record<string, unknown>): void {
  socket.emit('message', JSON.stringify({ type: 'chat.side_question', sessionId: SESSION_ID, ...frame }));
}

const sideQuestionFrames = (socket: FakeSocket, id?: string) =>
  socket.frames.filter((frame) => frame.kind === 'side_question' && (id === undefined || frame.sideQuestionId === id));

const protocolErrorCodes = (socket: FakeSocket) =>
  socket.frames.filter((frame) => frame.kind === 'protocol_error').map((frame) => frame.code);

test('chat.side_question is accepted while a run is in progress and leaves that run alone', { timeout: 5000 }, async () => {
  await withGateway(async ({ asker, asks }) => {
    const run = chatRunRegistry.startRun({
      appSessionId: SESSION_ID,
      provider: 'claude',
      providerSessionId: PROVIDER_SESSION_ID,
      connection: null,
      userId: 1,
    });
    assert.ok(run);

    sendSideQuestion(asker, { sideQuestionId: 'sq-1', question: 'what is this file for?' });
    await settle();

    assert.ok(!protocolErrorCodes(asker).includes('RUN_IN_PROGRESS'));
    assert.equal(asks.length, 1);
    assert.equal(asks[0].request.question, 'what is this file for?');
    assert.equal(chatRunRegistry.getRun(SESSION_ID), run, 'the running turn is still the registered one');
    assert.equal(sideQuestionsService.getById('sq-1')?.status, 'running');
  });
});

test('chat.side_question is accepted while only background work runs', { timeout: 5000 }, async () => {
  // The state `chat.send` refuses: the turn has ended, background agents still run.
  await withGateway(async ({ asker, watcher, asks }) => {
    sendSideQuestion(asker, { sideQuestionId: 'sq-bg', question: 'what are the agents doing?' });
    await settle();

    assert.equal(asks.length, 1);
    assert.equal(asks[0].request.question, 'what are the agents doing?');
    assert.deepEqual(protocolErrorCodes(asker), []);
    assert.equal(chatRunRegistry.isProcessing(SESSION_ID), false);
    assert.equal(sideQuestionFrames(watcher, 'sq-bg')[0]?.phase, 'started');
  }, { backgroundWork: true });
});

test('chat.side_question registers no run of its own', { timeout: 5000 }, async () => {
  await withGateway(async ({ asker, asks }) => {
    sendSideQuestion(asker, { sideQuestionId: 'sq-1', question: 'quick question' });
    await settle();

    assert.equal(asks.length, 1);
    assert.equal(chatRunRegistry.getRun(SESSION_ID), undefined);
    assert.equal(chatRunRegistry.isProcessing(SESSION_ID), false);
  });
});

test('a chat.send after a pending chat.side_question still starts its turn', { timeout: 5000 }, async () => {
  await withGateway(async ({ asker, asks, runs }) => {
    sendSideQuestion(asker, { sideQuestionId: 'sq-1', question: 'quick question' });
    await settle();
    asker.emit('message', JSON.stringify({ type: 'chat.send', sessionId: SESSION_ID, content: 'next turn' }));
    await settle();

    assert.equal(asks.length, 1);
    assert.equal(runs.length, 1);
    assert.equal(runs[0].command, 'next turn');
    assert.deepEqual(protocolErrorCodes(asker), []);
    assert.equal(chatRunRegistry.isProcessing(SESSION_ID), true);
  });
});

test('the provider session id and project path come from the session row, the model from the frame', { timeout: 5000 }, async () => {
  await withGateway(async ({ asker, asks, projectPath }) => {
    sendSideQuestion(asker, {
      sideQuestionId: 'sq-1',
      question: 'which model?',
      options: { model: 'claude-opus-5' },
      providerSessionId: 'forged-id',
      projectPath: '/forged/path',
    });
    await settle();

    assert.equal(asks.length, 1);
    assert.equal(asks[0].provider, 'claude');
    assert.equal(asks[0].request.appSessionId, SESSION_ID);
    assert.equal(asks[0].request.providerSessionId, PROVIDER_SESSION_ID);
    assert.equal(asks[0].request.projectPath, projectPath);
    assert.equal(asks[0].request.model, 'claude-opus-5');
    assert.equal(sideQuestionsService.getById('sq-1')?.model, 'claude-opus-5');
  });
});

test('started, delta and done reach every connected chat client', { timeout: 5000 }, async () => {
  await withGateway(async ({ asker, watcher, asks }) => {
    sendSideQuestion(asker, { sideQuestionId: 'sq-1', question: 'what is this?' });
    await settle();
    assert.equal(asks.length, 1);

    asks[0].sink.delta('An ');
    asks[0].sink.delta('answer.');
    asks[0].resolve({ status: 'done', answer: 'An answer.' });
    await settle();

    for (const socket of [asker, watcher]) {
      const frames = sideQuestionFrames(socket, 'sq-1');
      assert.deepEqual(frames.map((frame) => frame.phase), ['started', 'delta', 'delta', 'done']);
      assert.deepEqual(frames.slice(1, 3).map((frame) => frame.text), ['An ', 'answer.']);
      assert.ok(frames.every((frame) => frame.sessionId === SESSION_ID));
      const done = frames[3].sideQuestion as Record<string, unknown>;
      assert.equal(done.answer, 'An answer.');
      assert.equal(done.status, 'done');
    }
    assert.equal(sideQuestionsService.getById('sq-1')?.status, 'done');
  });
});

test('closing the asking socket does not abort its side question', { timeout: 5000 }, async () => {
  await withGateway(async ({ asker, watcher, asks }) => {
    sendSideQuestion(asker, { sideQuestionId: 'sq-1', question: 'still there?' });
    await settle();
    assert.equal(asks.length, 1);

    asker.readyState = 3;
    asker.emit('close');
    await settle();
    assert.equal(asks[0].request.signal.aborted, false);

    asks[0].sink.delta('yes');
    asks[0].resolve({ status: 'done', answer: 'yes' });
    await settle();

    assert.equal(sideQuestionsService.getById('sq-1')?.status, 'done');
    assert.equal(sideQuestionsService.getById('sq-1')?.answer, 'yes');
    assert.equal(sideQuestionFrames(watcher, 'sq-1').at(-1)?.phase, 'done');
  });
});

test('an empty question is refused with a side_question error on the asking socket only', { timeout: 5000 }, async () => {
  await withGateway(async ({ asker, watcher, asks }) => {
    sendSideQuestion(asker, { sideQuestionId: 'sq-empty', question: '   ' });
    await settle();

    assert.equal(asks.length, 0);
    assert.equal(sideQuestionsService.getById('sq-empty'), null);
    const frames = sideQuestionFrames(asker, 'sq-empty');
    assert.equal(frames.length, 1);
    assert.equal(frames[0].phase, 'error');
    assert.equal(frames[0].sessionId, SESSION_ID);
    assert.equal(typeof frames[0].error, 'string');
    assert.deepEqual(watcher.frames, []);
  });
});

test('a question for an unknown session is refused on the asking socket only', { timeout: 5000 }, async () => {
  await withGateway(async ({ asker, watcher, asks }) => {
    asker.emit('message', JSON.stringify({
      type: 'chat.side_question',
      sessionId: 'no-such-session',
      sideQuestionId: 'sq-lost',
      question: 'anyone?',
    }));
    await settle();

    assert.equal(asks.length, 0);
    assert.ok(protocolErrorCodes(asker).includes('SESSION_NOT_FOUND'));
    const frames = sideQuestionFrames(asker, 'sq-lost');
    assert.equal(frames.length, 1);
    assert.equal(frames[0].phase, 'error');
    assert.deepEqual(watcher.frames, []);
  });
});

test('side question ids outside 1 to 100 characters of [A-Za-z0-9_-] are refused', { timeout: 5000 }, async () => {
  await withGateway(async ({ asker, watcher, asks }) => {
    for (const sideQuestionId of ['', 'has space', 'semi;colon', '../escape', 'x'.repeat(101), 42]) {
      sendSideQuestion(asker, { sideQuestionId, question: 'valid question' });
    }
    sendSideQuestion(asker, { question: 'no id at all' });
    await settle();

    assert.equal(asks.length, 0);
    assert.ok(
      !protocolErrorCodes(asker).includes('UNKNOWN_MESSAGE_TYPE'),
      'refused for its id, not because the frame type is unknown',
    );
    assert.deepEqual(sideQuestionsService.listForSession(SESSION_ID), []);
    assert.deepEqual(watcher.frames, []);
  });
});

test('a side question id of exactly 100 allowed characters is accepted', { timeout: 5000 }, async () => {
  await withGateway(async ({ asker, asks }) => {
    const id = `Ab9_-${'z'.repeat(95)}`;
    sendSideQuestion(asker, { sideQuestionId: id, question: 'long id' });
    await settle();

    assert.equal(asks.length, 1);
    assert.equal(sideQuestionsService.getById(id)?.question, 'long id');
  });
});

test('a duplicate id is refused with the existing side question, to the asker only', { timeout: 5000 }, async () => {
  await withGateway(async ({ asker, watcher, asks }) => {
    sendSideQuestion(asker, { sideQuestionId: 'sq-1', question: 'first ask' });
    await settle();
    asks[0].resolve({ status: 'done', answer: 'a good answer' });
    await settle();
    const watcherFramesBefore = watcher.frames.length;

    // A retry of the same id, as a reconnecting client might send it.
    sendSideQuestion(asker, { sideQuestionId: 'sq-1', question: 'first ask again' });
    await settle();

    assert.equal(asks.length, 1, 'the runtime is not asked twice');
    const refusal = sideQuestionFrames(asker, 'sq-1').at(-1);
    assert.equal(refusal?.phase, 'error');
    const existing = refusal?.sideQuestion as Record<string, unknown> | undefined;
    assert.equal(existing?.id, 'sq-1');
    assert.equal(existing?.question, 'first ask');
    assert.equal(existing?.answer, 'a good answer');
    assert.equal(existing?.status, 'done');
    assert.equal(watcher.frames.length, watcherFramesBefore, 'the other tab hears nothing of the refusal');

    // The good answer is untouched by the refused retry.
    const kept = sideQuestionsService.getById('sq-1');
    assert.equal(kept?.status, 'done');
    assert.equal(kept?.answer, 'a good answer');
  });
});

test('a cursor session\'s side question is refused on the asking socket, creates nothing and never reaches the runtime', { timeout: 5000 }, async () => {
  await withGateway(async ({ asker, watcher, asks }) => {
    sendSideQuestion(asker, { sessionId: CURSOR_SESSION_ID, sideQuestionId: 'sq-cursor', question: 'can cursor answer this?' });
    await settle();

    assert.equal(asks.length, 0, 'the runtime is never asked');
    assert.equal(sideQuestionsService.getById('sq-cursor'), null);
    assert.deepEqual(sideQuestionsService.listForSession(CURSOR_SESSION_ID), []);
    const frames = sideQuestionFrames(asker, 'sq-cursor');
    assert.equal(frames.length, 1);
    assert.equal(frames[0].phase, 'error');
    assert.equal(frames[0].sessionId, CURSOR_SESSION_ID);
    assert.equal(typeof frames[0].error, 'string');
    assert.deepEqual(watcher.frames, [], 'the other tab hears nothing of the refusal');
  });
});

test('chat.btw is no longer handled: it is an unknown frame type and asks nothing', { timeout: 5000 }, async () => {
  await withGateway(async ({ asker, watcher, asks }) => {
    asker.emit('message', JSON.stringify({
      type: 'chat.btw',
      sessionId: SESSION_ID,
      sideQuestionId: 'sq-old-frame',
      question: 'the old frame',
    }));
    await settle();

    assert.equal(asks.length, 0);
    assert.equal(sideQuestionsService.getById('sq-old-frame'), null);
    assert.ok(protocolErrorCodes(asker).includes('UNKNOWN_MESSAGE_TYPE'));
    assert.deepEqual(sideQuestionFrames(asker, 'sq-old-frame'), []);
    assert.deepEqual(watcher.frames, []);
  });
});

test('codex and opencode sessions\' side questions reach the runtime with their own provider', { timeout: 5000 }, async () => {
  await withGateway(async ({ asker, asks }) => {
    sendSideQuestion(asker, { sessionId: CODEX_SESSION_ID, sideQuestionId: 'sq-codex', question: 'codex, are you there?' });
    sendSideQuestion(asker, { sessionId: OPENCODE_SESSION_ID, sideQuestionId: 'sq-opencode', question: 'opencode, are you there?' });
    await settle();

    // Gated on the capability, not on the provider being Claude.
    assert.deepEqual(
      asks.map((ask) => [ask.provider, ask.request.appSessionId, ask.request.question]).sort(),
      [
        ['codex', CODEX_SESSION_ID, 'codex, are you there?'],
        ['opencode', OPENCODE_SESSION_ID, 'opencode, are you there?'],
      ],
    );
    assert.equal(sideQuestionsService.getById('sq-codex')?.sessionId, CODEX_SESSION_ID);
    assert.equal(sideQuestionsService.getById('sq-opencode')?.sessionId, OPENCODE_SESSION_ID);
  });
});
