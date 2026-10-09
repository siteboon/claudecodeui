import assert from 'node:assert/strict';
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';

// ALLOWED_PATHS is read when the shared utils module is first evaluated, and
// the database path when it first connects, so both are set before the
// imports below.
const fixtureRoot = await realpath(await mkdtemp(path.join(os.tmpdir(), 'session-upsert-allowed-')));
const allowedDirectory = path.join(fixtureRoot, 'allowed');
await mkdir(allowedDirectory, { recursive: true });

const previousEnvironment = {
  ALLOWED_PATHS: process.env.ALLOWED_PATHS,
  DATABASE_PATH: process.env.DATABASE_PATH,
};
process.env.ALLOWED_PATHS = allowedDirectory;
process.env.DATABASE_PATH = path.join(fixtureRoot, 'auth.db');

const { closeConnection, initializeDatabase, sessionsDb } = await import('@/modules/database/index.js');
const { broadcastSessionUpserted } = await import('@/modules/websocket/services/session-upsert-broadcast.service.js');
const { connectedClients } = await import('@/modules/websocket/services/websocket-state.service.js');

closeConnection();
await initializeDatabase();

after(async () => {
  connectedClients.clear();
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

class FakeConnection {
  readyState = 1; // WS_OPEN_STATE
  frames: Array<Record<string, unknown>> = [];

  send(data: string): void {
    this.frames.push(JSON.parse(data) as Record<string, unknown>);
  }
}

test('a session in a project outside ALLOWED_PATHS is never announced', async () => {
  sessionsDb.createAppSession('inside-session', 'claude', path.join(allowedDirectory, 'proj-in'));
  sessionsDb.createAppSession('outside-session', 'claude', path.join(fixtureRoot, 'outside', 'proj-out'));
  const connection = new FakeConnection();
  connectedClients.add(connection as never);

  await broadcastSessionUpserted('outside-session');
  await broadcastSessionUpserted('inside-session');

  assert.deepEqual(connection.frames.map((frame) => frame.sessionId), ['inside-session']);
});
