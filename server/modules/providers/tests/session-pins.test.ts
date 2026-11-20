import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import express, { type Request, type Response, type NextFunction } from 'express';

import { closeConnection, initializeDatabase, projectsDb, sessionsDb, userDb } from '@/modules/database/index.js';
import providerRouter from '@/modules/providers/provider.routes.js';
import { sessionsService } from '@/modules/providers/services/sessions.service.js';
import { AppError } from '@/shared/index.js';

async function withServer(run: (baseUrl: string, userId: number, otherUserId: number) => Promise<void>): Promise<void> {
  const previous = process.env.DATABASE_PATH;
  const directory = await mkdtemp(path.join(tmpdir(), 'session-pins-routes-'));
  closeConnection();
  process.env.DATABASE_PATH = path.join(directory, 'auth.db');
  await initializeDatabase();
  const userId = Number(userDb.createUser('pin-owner', 'unused-test-hash').id);
  const otherUserId = Number(userDb.createUser('another-owner', 'unused-test-hash').id);
  sessionsDb.createAppSession('pin-target', 'codex', '/workspace/pins', 'Pin this session');
  const app = express().use(express.json());
  app.use((req, _res, next) => {
    (req as Request & { user: { id: number } }).user = { id: Number(req.get('x-test-user')) };
    next();
  });
  app.use('/api/providers', providerRouter);
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const appError = error instanceof AppError ? error : new AppError(String(error));
    res.status(appError.statusCode).json({ error: { code: appError.code } });
  });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    await run(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/providers/sessions`, userId, otherUserId);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    closeConnection();
    if (previous === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previous;
    await rm(directory, { recursive: true, force: true });
  }
}

test('pins API uses authenticated ownership, serves complete summaries, and accepts idempotent explicit state', async () => {
  await withServer(async (baseUrl, userId, otherUserId) => {
    const pin = await fetch(`${baseUrl}/pin-target/pin`, {
      method: 'PUT', headers: { 'content-type': 'application/json', 'x-test-user': String(userId) },
      body: JSON.stringify({ isPinned: true, userId: otherUserId }),
    });
    assert.equal(pin.status, 200);
    const { data } = await pin.json() as { data: { sessions: Array<Record<string, unknown>> } };
    assert.equal(data.sessions[0]?.sessionId, 'pin-target');
    assert.equal(data.sessions[0]?.sessionTitle, 'Pin this session');
    assert.equal(data.sessions[0]?.projectDisplayName, 'pins');
    assert.ok(data.sessions[0]?.projectId);
    assert.match(String(data.sessions[0]?.lastActivity), /T.*Z$/);
    sessionsDb.createAppSession('recent-session', 'codex', '/workspace/pins', 'Recent session');
    assert.equal(sessionsService.listRecentSessions(1, 0).conversations[0]?.sessionId, 'recent-session');
    assert.equal(sessionsService.listPinnedSessions(userId)[0]?.sessionId, 'pin-target', 'pins are queried beyond the recent page');
    assert.deepEqual(sessionsService.listPinnedSessions(otherUserId), []);
    const list = await fetch(`${baseUrl}/pinned`, { headers: { 'x-test-user': String(userId) } });
    assert.equal(list.status, 200, 'static pinned route must precede session-id lookup');

    sessionsDb.updateSessionCustomName('pin-target', 'Renamed while pinned');
    projectsDb.updateCustomProjectName('/workspace/pins', 'Renamed workspace');
    const renamed = sessionsService.setSessionPinned(userId, 'pin-target', true);
    assert.equal(renamed.length, 1);
    assert.equal(renamed[0]?.sessionTitle, 'Renamed while pinned');
    assert.equal(renamed[0]?.projectDisplayName, 'Renamed workspace');
    const unpin = await fetch(`${baseUrl}/pin-target/pin`, {
      method: 'PUT', headers: { 'content-type': 'application/json', 'x-test-user': String(userId) },
      body: JSON.stringify({ isPinned: false }),
    });
    assert.equal(unpin.status, 200);
    assert.deepEqual(sessionsService.listPinnedSessions(userId), []);
  });
});

test('pins API validates authentication, body, id and archive state without changing pins', async () => {
  await withServer(async (baseUrl, userId) => {
    assert.equal((await fetch(`${baseUrl}/pinned`)).status, 401);
    for (const [id, body, expected] of [
      ['pin-target', {}, 400], ['pin-target', { isPinned: 'true' }, 400],
      ['pin-target', { isPinned: 1 }, 400], ['bad%2Fid', { isPinned: true }, 400],
      ['missing-session', { isPinned: true }, 404],
    ] as const) {
      const response = await fetch(`${baseUrl}/${id}/pin`, {
        method: 'PUT', headers: { 'content-type': 'application/json', 'x-test-user': String(userId) },
        body: JSON.stringify(body),
      });
      assert.equal(response.status, expected, JSON.stringify({ id, body }));
    }
    sessionsDb.updateSessionIsArchived('pin-target', true);
    assert.throws(() => sessionsService.setSessionPinned(userId, 'pin-target', true), { code: 'SESSION_ARCHIVED' });
    sessionsDb.updateSessionIsArchived('pin-target', false);
    projectsDb.updateProjectIsArchived('/workspace/pins', true);
    assert.throws(() => sessionsService.setSessionPinned(userId, 'pin-target', true), { code: 'SESSION_ARCHIVED' });
    assert.deepEqual(sessionsService.setSessionPinned(userId, 'already-deleted', false), [], 'unpin remains idempotent after deletion');
  });
});
