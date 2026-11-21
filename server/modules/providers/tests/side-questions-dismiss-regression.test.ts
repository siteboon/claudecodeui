import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection } from '@/modules/database/index.js';
import { createSideQuestionsService } from '@/modules/providers/services/side-questions.service.js';
import type { SideQuestionEvent } from '@/shared/types.js';

/**
 * Regression for the end review's finding 2: dismiss must broadcast
 * `dismissed`, and a dismiss by another session's id must abort nothing and
 * report false instead of acting on a row it does not own.
 */

const SESSION_ID = 'side-question-dismiss-session';
const OTHER_SESSION_ID = 'side-question-dismiss-other-session';

/**
 * Side questions live in server memory, so these run with no database
 * initialised. DATABASE_PATH points at an empty temp file: a service that
 * wrongly reaches for the database fails on a missing table instead of
 * opening the operator's real database.
 */
async function withoutDatabase(runTest: () => void | Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'side-questions-dismiss-'));

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

test('dismiss broadcasts a dismissed event on success', { timeout: 5000 }, async () => {
  await withoutDatabase(async () => {
    const service = createSideQuestionsService();
    const events: SideQuestionEvent[] = [];
    const runtime = {
      askSideQuestion: () => new Promise(() => {}),
    };

    // Not awaited: the mock runtime never resolves, the same way a running
    // side question never resolves until dismiss aborts its signal.
    void service.ask(
      {
        sessionId: SESSION_ID,
        provider: 'claude',
        providerSessionId: null,
        projectPath: null,
        sideQuestionId: 'sq-1',
        question: 'pending question',
        model: null,
      },
      runtime as never,
      (event) => events.push(event),
    );

    const dismissed = service.dismiss(SESSION_ID, 'sq-1', (event) => events.push(event));
    assert.equal(dismissed, true);

    const dismissedEvent = events.find((event) => event.phase === 'dismissed');
    assert.ok(dismissedEvent, 'a dismissed event was broadcast');
    assert.equal(dismissedEvent?.sessionId, SESSION_ID);
    assert.equal(dismissedEvent?.sideQuestionId, 'sq-1');
    assert.equal(service.getById('sq-1'), null, 'the dismissed question is gone from memory');
  });
});

test('dismiss by another session\'s id aborts nothing and keeps the question', { timeout: 5000 }, async () => {
  await withoutDatabase(async () => {
    const service = createSideQuestionsService();
    const events: SideQuestionEvent[] = [];
    let aborted = false;
    const runtime = {
      askSideQuestion: (_provider: unknown, request: { signal: AbortSignal }) =>
        new Promise((resolve) => {
          request.signal.addEventListener('abort', () => {
            aborted = true;
            resolve({ status: 'error', error: 'aborted', answer: '' });
          });
        }),
    };

    // Not awaited: the real abort (from the owning session's dismiss below)
    // is what lets this settle, and the test does not need that to happen.
    void service.ask(
      {
        sessionId: OTHER_SESSION_ID,
        provider: 'claude',
        providerSessionId: null,
        projectPath: null,
        sideQuestionId: 'sq-2',
        question: 'owned by the other session',
        model: null,
      },
      runtime as never,
      () => {},
    );

    const dismissed = service.dismiss(SESSION_ID, 'sq-2', (event) => events.push(event));
    assert.equal(dismissed, false, 'the wrong session\'s dismiss reports false');
    assert.equal(aborted, false, 'the other session\'s running question is never aborted');
    assert.deepEqual(events, [], 'nothing is broadcast for a no-op dismiss');
    assert.equal(service.getById('sq-2')?.sessionId, OTHER_SESSION_ID, 'the other session keeps its question');

    assert.equal(service.dismiss(OTHER_SESSION_ID, 'sq-2', () => {}), true, 'the owning session can still dismiss it');
    assert.equal(aborted, true, 'its own session can abort it');
  });
});
