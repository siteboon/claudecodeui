import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, initializeDatabase, sessionsDb, sideQuestionsDb } from '@/modules/database/index.js';
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

const SESSION_ID = 'btw-foreign-session-asker';
const OTHER_SESSION_ID = 'btw-foreign-session-other';
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

test('a sideQuestionId that exists in another session is refused, not crashed, and leaks no row', { timeout: 5000 }, async () => {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'chat-btw-foreign-'));
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
    // A row that already exists under a different session, with the id the
    // asker is about to reuse.
    sideQuestionsDb.create({ id: SHARED_ID, sessionId: OTHER_SESSION_ID, question: 'owned elsewhere', model: null });

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
      JSON.stringify({ type: 'chat.btw', sessionId: SESSION_ID, sideQuestionId: SHARED_ID, question: 'mine too?' }),
    );
    await settle();

    const refusal = asker.frames.find((frame) => frame.kind === 'side_question' && frame.sideQuestionId === SHARED_ID);
    assert.equal(refusal?.phase, 'error', 'the reused id is refused, not inserted');
    assert.equal(refusal?.sideQuestion, undefined, 'the other session\'s row is never attached to this refusal');

    const otherRow = sideQuestionsDb.getById(SHARED_ID);
    assert.equal(otherRow?.session_id, OTHER_SESSION_ID, 'the other session still owns the row, untouched');

    assert.deepEqual(unhandledRejections, [], 'the duplicate id never reaches ask, so nothing rejects unhandled');
  } finally {
    process.off('unhandledRejection', onUnhandled);
    connectedClients.clear();
    chatRunRegistry.clearAll();
    closeConnection();
    if (previousDatabasePath === undefined) {
      delete process.env.DATABASE_PATH;
    } else {
      process.env.DATABASE_PATH = previousDatabasePath;
    }
    await rm(tempDirectory, { recursive: true, force: true });
  }
});
