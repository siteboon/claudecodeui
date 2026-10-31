import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import express, { type NextFunction, type Request, type Response } from 'express';

import { closeConnection, getConnection, initializeDatabase, sessionsDb } from '@/modules/database/index.js';
import providerRouter from '@/modules/providers/provider.routes.js';
import { sideQuestionsService } from '@/modules/providers/services/side-questions.service.js';
import type { SideQuestion, SideQuestionOutcome, SideQuestionRuntime } from '@/shared/types.js';
import { AppError } from '@/shared/utils.js';

const SESSION_ID = 'side-question-routes-session';
const OTHER_SESSION_ID = 'side-question-routes-other-session';

async function withProviderServer(run: (baseUrl: string) => Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'side-questions-routes-'));

  closeConnection();
  process.env.DATABASE_PATH = path.join(tempDirectory, 'auth.db');
  await writeFile(process.env.DATABASE_PATH, '');
  await initializeDatabase();
  // The sessions table is still needed for the session rows below. A
  // `side_questions` table is not: should one exist, drop it, so a route
  // that still reads it fails here instead of passing on a stale schema.
  getConnection().exec('DROP TABLE IF EXISTS side_questions');

  const app = express().use(express.json()).use('/api/providers', providerRouter);
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof AppError) {
      res.status(error.statusCode).json({
        success: false,
        error: { code: error.code, message: error.message },
      });
      return;
    }
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR' } });
  });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');

  try {
    // App sessions with no provider transcript yet: history is empty, so the
    // route's own response is known without a provider on disk.
    sessionsDb.createAppSession(SESSION_ID, 'claude', path.join(tempDirectory, 'workspace'), 'BTW routes');
    sessionsDb.createAppSession(OTHER_SESSION_ID, 'claude', path.join(tempDirectory, 'workspace'), 'Other');
    const address = server.address() as AddressInfo;
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
    try {
      // The routes use the process-wide service, whose memory outlives one
      // test; clear both sessions so the next test starts empty. After the
      // server closed, so a throw here cannot leave the file hanging, and
      // before the connection closes, so nothing reopens the real database.
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
}

const tick = () => new Promise((resolve) => { setTimeout(resolve, 5); });

/**
 * Puts a side question into the process-wide service the routes read. With
 * an `answer` it finishes as done at once; without one it stays running
 * until a dismiss aborts it.
 */
async function seed(
  sideQuestionId: string,
  sessionId: string,
  question: string,
  model: string | null,
  answer?: string,
): Promise<void> {
  const runtime: SideQuestionRuntime = {
    askSideQuestion: (_provider, request) => new Promise<SideQuestionOutcome>((resolve) => {
      if (answer !== undefined) {
        resolve({ status: 'done', answer });
        return;
      }
      request.signal.addEventListener('abort', () => resolve({ status: 'error', error: 'aborted', answer: '' }));
    }),
  };
  const asking = sideQuestionsService.ask(
    { sessionId, provider: 'claude', providerSessionId: null, projectPath: null, sideQuestionId, question, model },
    runtime,
    () => {},
  );
  if (answer !== undefined) {
    await asking;
  }
}

type HistoryPayload = {
  success: boolean;
  data: {
    messages: unknown[];
    total: number;
    hasMore: boolean;
    sideQuestions: SideQuestion[];
  };
};

test('the history route keeps its response and adds the session\'s side questions', { timeout: 5000 }, async () => {
  await withProviderServer(async (baseUrl) => {
    await seed('sq-a', SESSION_ID, 'first', null);
    await tick();
    await seed('sq-b', SESSION_ID, 'second', 'claude-opus-5', 'answered');
    await seed('sq-other', OTHER_SESSION_ID, 'elsewhere', null);

    const response = await fetch(`${baseUrl}/api/providers/sessions/${SESSION_ID}/messages`);
    const payload = await response.json() as HistoryPayload;

    assert.equal(response.status, 200);
    assert.equal(payload.success, true);
    assert.deepEqual(payload.data.messages, []);
    assert.equal(payload.data.total, 0);
    assert.equal(payload.data.hasMore, false);

    assert.deepEqual(payload.data.sideQuestions.map((item) => item.id), ['sq-a', 'sq-b']);
    const answered = payload.data.sideQuestions[1];
    assert.equal(answered.sessionId, SESSION_ID);
    assert.equal(answered.question, 'second');
    assert.equal(answered.answer, 'answered');
    assert.equal(answered.status, 'done');
    assert.equal(answered.error, null);
    assert.equal(answered.model, 'claude-opus-5');
    assert.ok(answered.createdAt);
    assert.ok(answered.finishedAt);
  });
});

test('the history route returns the whole side-question list on every page', { timeout: 5000 }, async () => {
  await withProviderServer(async (baseUrl) => {
    await seed('sq-a', SESSION_ID, 'first', null);
    await seed('sq-b', SESSION_ID, 'second', null);

    const response = await fetch(`${baseUrl}/api/providers/sessions/${SESSION_ID}/messages?limit=1&offset=3`);
    const payload = await response.json() as HistoryPayload;

    assert.equal(response.status, 200);
    assert.equal(payload.data.sideQuestions.length, 2);
  });
});

test('the history route returns an empty side-question list for a session without any', { timeout: 5000 }, async () => {
  await withProviderServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/providers/sessions/${SESSION_ID}/messages`);
    const payload = await response.json() as HistoryPayload;

    assert.equal(response.status, 200);
    assert.deepEqual(payload.data.sideQuestions, []);
  });
});

test('DELETE removes a side question and answers deleted: true', { timeout: 5000 }, async () => {
  await withProviderServer(async (baseUrl) => {
    await seed('sq-a', SESSION_ID, 'first', null);
    await seed('sq-b', SESSION_ID, 'second', null);

    const response = await fetch(`${baseUrl}/api/providers/sessions/${SESSION_ID}/side-questions/sq-a`, {
      method: 'DELETE',
    });
    const payload = await response.json() as { success: boolean; data: { deleted: boolean } };

    assert.equal(response.status, 200);
    assert.equal(payload.success, true);
    assert.deepEqual(payload.data, { deleted: true });
    assert.equal(sideQuestionsService.getById('sq-a'), null);
    assert.ok(sideQuestionsService.getById('sq-b'), 'only the named one goes');
    // The session itself is untouched by the more specific route.
    assert.ok(sessionsDb.getSessionById(SESSION_ID));
  });
});

test('DELETE of an unknown side question is a 404', { timeout: 5000 }, async () => {
  await withProviderServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/providers/sessions/${SESSION_ID}/side-questions/never-existed`, {
      method: 'DELETE',
    });
    const payload = await response.json() as { success: boolean };

    assert.equal(response.status, 404);
    assert.equal(payload.success, false);
  });
});

test('DELETE through another session\'s id is a 404 and keeps the question', { timeout: 5000 }, async () => {
  await withProviderServer(async (baseUrl) => {
    await seed('sq-a', SESSION_ID, 'first', null);

    const response = await fetch(`${baseUrl}/api/providers/sessions/${OTHER_SESSION_ID}/side-questions/sq-a`, {
      method: 'DELETE',
    });

    assert.equal(response.status, 404);
    assert.ok(sideQuestionsService.getById('sq-a'));
  });
});

test('the database has no side_questions table: side questions live in memory only', { timeout: 5000 }, async () => {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'side-questions-schema-'));
  closeConnection();
  process.env.DATABASE_PATH = path.join(tempDirectory, 'auth.db');
  try {
    await initializeDatabase();
    const tables = getConnection()
      .prepare("SELECT name FROM sqlite_master WHERE name LIKE '%side_question%'")
      .all() as Array<{ name: string }>;
    assert.deepEqual(tables.map((table) => table.name), []);
  } finally {
    closeConnection();
    if (previousDatabasePath === undefined) {
      delete process.env.DATABASE_PATH;
    } else {
      process.env.DATABASE_PATH = previousDatabasePath;
    }
    await rm(tempDirectory, { recursive: true, force: true });
  }
});
