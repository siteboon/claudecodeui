import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import express, { type NextFunction, type Request, type Response } from 'express';

import { closeConnection, initializeDatabase, sessionsDb, sideQuestionsDb } from '@/modules/database/index.js';
import providerRouter from '@/modules/providers/provider.routes.js';
import type { SideQuestion } from '@/shared/types.js';
import { AppError } from '@/shared/utils.js';

const SESSION_ID = 'btw-routes-session';
const OTHER_SESSION_ID = 'btw-routes-other-session';

async function withProviderServer(run: (baseUrl: string) => Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'side-questions-routes-'));

  closeConnection();
  process.env.DATABASE_PATH = path.join(tempDirectory, 'auth.db');
  await writeFile(process.env.DATABASE_PATH, '');
  await initializeDatabase();

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
    closeConnection();
    if (previousDatabasePath === undefined) {
      delete process.env.DATABASE_PATH;
    } else {
      process.env.DATABASE_PATH = previousDatabasePath;
    }
    await rm(tempDirectory, { recursive: true, force: true });
  }
}

const tick = () => new Promise((resolve) => { setTimeout(resolve, 5); });

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
    sideQuestionsDb.create({ id: 'sq-a', sessionId: SESSION_ID, question: 'first', model: null });
    await tick();
    sideQuestionsDb.create({ id: 'sq-b', sessionId: SESSION_ID, question: 'second', model: 'claude-opus-5' });
    sideQuestionsDb.finish('sq-b', { status: 'done', answer: 'answered' });
    sideQuestionsDb.create({ id: 'sq-other', sessionId: OTHER_SESSION_ID, question: 'elsewhere', model: null });

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
    sideQuestionsDb.create({ id: 'sq-a', sessionId: SESSION_ID, question: 'first', model: null });
    sideQuestionsDb.create({ id: 'sq-b', sessionId: SESSION_ID, question: 'second', model: null });

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
    sideQuestionsDb.create({ id: 'sq-a', sessionId: SESSION_ID, question: 'first', model: null });
    sideQuestionsDb.create({ id: 'sq-b', sessionId: SESSION_ID, question: 'second', model: null });

    const response = await fetch(`${baseUrl}/api/providers/sessions/${SESSION_ID}/side-questions/sq-a`, {
      method: 'DELETE',
    });
    const payload = await response.json() as { success: boolean; data: { deleted: boolean } };

    assert.equal(response.status, 200);
    assert.equal(payload.success, true);
    assert.deepEqual(payload.data, { deleted: true });
    assert.equal(sideQuestionsDb.getById('sq-a'), null);
    assert.ok(sideQuestionsDb.getById('sq-b'), 'only the named one goes');
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

test('DELETE through another session\'s id is a 404 and keeps the row', { timeout: 5000 }, async () => {
  await withProviderServer(async (baseUrl) => {
    sideQuestionsDb.create({ id: 'sq-a', sessionId: SESSION_ID, question: 'first', model: null });

    const response = await fetch(`${baseUrl}/api/providers/sessions/${OTHER_SESSION_ID}/side-questions/sq-a`, {
      method: 'DELETE',
    });

    assert.equal(response.status, 404);
    assert.ok(sideQuestionsDb.getById('sq-a'));
  });
});
