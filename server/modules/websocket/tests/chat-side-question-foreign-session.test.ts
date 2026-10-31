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

/**
 * Regression for the end review's finding 1: a `sideQuestionId` that already
 * exists in another session must be refused, not crash the INSERT, and the
 * refusal must never leak the other session's row. A rejected `ask` (a
 * simulated DB error) must also not reach Node as an unhandled rejection.
 */

const SESSION_ID = 'side-question-foreign-session-asker';
const OTHER_SESSION_ID = 'side-question-foreign-session-other';
const SHARED_ID = 'sq-shared';

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

const settle = () => new Promise((resolve) => { setTimeout(resolve, 30); });

test('a sideQuestionId that exists in another session is refused, not crashed, and leaks nothing', { timeout: 5000 }, async () => {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'chat-side-question-foreign-'));
  closeConnection();
  process.env.DATABASE_PATH = path.join(tempDirectory, 'auth.db');
  await initializeDatabase();

  const unhandledRejections: unknown[] = [];
  const onUnhandled = (reason: unknown) => unhandledRejections.push(reason);
  process.on('unhandledRejection', onUnhandled);

  const asker = createFakeSocket();
  try {
    sessionsDb.createAppSession(SESSION_ID, 'claude', tempDirectory, 'Asker session');
    sessionsDb.createAppSession(OTHER_SESSION_ID, 'claude', tempDirectory, 'Other session');
    // A side question that already exists under a different session, with
    // the id the asker is about to reuse.
    await sideQuestionsService.ask(
      {
        sessionId: OTHER_SESSION_ID,
        provider: 'claude',
        providerSessionId: null,
        projectPath: null,
        sideQuestionId: SHARED_ID,
        question: 'owned elsewhere',
        model: null,
      },
      { askSideQuestion: async () => ({ status: 'done', answer: 'the other session\'s answer' }) },
      () => {},
    );

    const runtime = {
      hasRuntime: (provider: string) => provider === 'claude',
      hasBackgroundWork: () => false,
      run: () => new Promise(() => {}),
      abort: async () => true,
      stopBackgroundTask: async () => false,
      resolveToolApproval: () => {},
      getPendingApprovalsForSession: () => [],
      askSideQuestion: (_provider: string, _request: SideQuestionRequest, _sink: SideQuestionSink) =>
        Promise.resolve<SideQuestionOutcome>({ status: 'done', answer: 'should never run' }),
    };

    handleChatConnection(asker as never, { user: { id: 1 } } as never, { runtime: runtime as never });

    asker.emit(
      'message',
      JSON.stringify({ type: 'chat.side_question', sessionId: SESSION_ID, sideQuestionId: SHARED_ID, question: 'mine too?' }),
    );
    await settle();

    const refusal = asker.frames.find((frame) => frame.kind === 'side_question' && frame.sideQuestionId === SHARED_ID);
    assert.equal(refusal?.phase, 'error', 'the reused id is refused, not inserted');
    assert.equal(refusal?.sideQuestion, undefined, 'the other session\'s row is never attached to this refusal');

    const other = sideQuestionsService.getById(SHARED_ID);
    assert.equal(other?.sessionId, OTHER_SESSION_ID, 'the other session still owns it, untouched');
    assert.equal(other?.question, 'owned elsewhere');
    assert.equal(other?.answer, 'the other session\'s answer');
    assert.deepEqual(sideQuestionsService.listForSession(SESSION_ID), [], 'nothing was created for the asker');

    assert.deepEqual(unhandledRejections, [], 'the duplicate id never reaches ask, so nothing rejects unhandled');
  } finally {
    process.off('unhandledRejection', onUnhandled);
    connectedClients.clear();
    chatRunRegistry.clearAll();
    try {
      // The process-wide service keeps its memory past this test; clear it.
      for (const sessionId of [SESSION_ID, OTHER_SESSION_ID]) {
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
});
