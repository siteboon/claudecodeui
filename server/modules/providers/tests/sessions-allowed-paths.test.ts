import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';

import express, { type NextFunction, type Request, type Response } from 'express';

// ALLOWED_PATHS is read when the shared utils module is first evaluated and
// the database path when it first connects, so both are set before importing.
const fixtureRoot = await realpath(await mkdtemp(path.join(os.tmpdir(), 'sessions-allowed-')));
const allowedDirectory = path.join(fixtureRoot, 'allowed');
const insideProjectPath = path.join(allowedDirectory, 'proj-in');
const outsideProjectPath = path.join(fixtureRoot, 'outside', 'proj-out');
await mkdir(insideProjectPath, { recursive: true });
await mkdir(outsideProjectPath, { recursive: true });

const previousEnvironment = {
  ALLOWED_PATHS: process.env.ALLOWED_PATHS,
  DATABASE_PATH: process.env.DATABASE_PATH,
};
process.env.ALLOWED_PATHS = allowedDirectory;
process.env.DATABASE_PATH = path.join(fixtureRoot, 'auth.db');

const { closeConnection, initializeDatabase, sessionsDb } = await import('@/modules/database/index.js');
const { sessionsService } = await import('@/modules/providers/services/sessions.service.js');
const { searchConversations } = await import('@/modules/providers/services/session-conversations-search.service.js');
const { default: providerRoutes } = await import('@/modules/providers/provider.routes.js');
const { AppError } = await import('@/shared/utils.js');

closeConnection();
await initializeDatabase();
sessionsDb.createSession(
  'inside-session', 'claude', insideProjectPath, 'Inside conversation',
  '2026-09-01T10:00:00.000Z', '2026-09-01T10:00:00.000Z',
);
sessionsDb.createSession(
  'outside-newer', 'claude', outsideProjectPath, 'Outside conversation newer',
  '2026-09-03T10:00:00.000Z', '2026-09-03T10:00:00.000Z',
);
sessionsDb.createSession(
  'outside-older', 'codex', outsideProjectPath, 'Outside conversation older',
  '2026-09-02T10:00:00.000Z', '2026-09-02T10:00:00.000Z',
);
sessionsDb.createSession(
  'outside-archived', 'claude', outsideProjectPath, 'Outside archived conversation',
  '2026-09-04T10:00:00.000Z', '2026-09-04T10:00:00.000Z',
);
sessionsDb.updateSessionIsArchived('outside-archived', true);
sessionsDb.createSession(
  'inside-archived', 'claude', insideProjectPath, 'Inside archived conversation',
  '2026-09-04T10:00:00.000Z', '2026-09-04T10:00:00.000Z',
);
sessionsDb.updateSessionIsArchived('inside-archived', true);

after(async () => {
  closeConnection();
  for (const [name, value] of Object.entries(previousEnvironment)) {
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }
  await rm(fixtureRoot, { recursive: true, force: true });
});

test('the recent conversations feed leaves out sessions outside ALLOWED_PATHS before paging', async () => {
  const firstPage = await sessionsService.listRecentSessions(1, 0);

  assert.deepEqual(firstPage.conversations.map((conversation) => conversation.sessionId), ['inside-session']);
  assert.equal(firstPage.total, 1);
  assert.equal(firstPage.hasMore, false);
});

test('the archived sessions list leaves out sessions outside ALLOWED_PATHS', async () => {
  const archived = await sessionsService.listArchivedSessions();

  assert.deepEqual(archived.map((session) => session.sessionId), ['inside-archived']);
});

test('conversation search does not match sessions outside ALLOWED_PATHS', async () => {
  const result = await searchConversations('conversation', 50);

  assert.deepEqual(result.titleResults.map((titleResult) => titleResult.sessionId), ['inside-session']);
});

test('session routes answer 403 for a session outside ALLOWED_PATHS', async () => {
  await assert.rejects(
    sessionsService.assertSessionAccessAllowed('outside-newer'),
    (error: unknown) => error instanceof AppError && error.statusCode === 403,
  );
  await sessionsService.assertSessionAccessAllowed('inside-session');
  await sessionsService.assertSessionAccessAllowed('unknown-session');

  const app = express();
  app.use(express.json());
  app.use('/api/providers', providerRoutes);
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    res.status(error instanceof AppError ? error.statusCode : 500).json({ error: String(error) });
  });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');

  try {
    const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    assert.equal((await fetch(`${baseUrl}/api/providers/sessions/outside-newer`)).status, 403);
    assert.equal(
      (await fetch(`${baseUrl}/api/providers/sessions/outside-newer`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ summary: 'renamed' }),
      })).status,
      403,
    );
    assert.equal((await fetch(`${baseUrl}/api/providers/sessions/inside-session`)).status, 200);

    const createOutside = await fetch(`${baseUrl}/api/providers/sessions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'claude', projectPath: outsideProjectPath }),
    });
    assert.equal(createOutside.status, 403);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  assert.equal(sessionsDb.getSessionById('outside-newer')?.custom_name, 'Outside conversation newer');
});
