import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, initializeDatabase, projectsDb, sessionsDb } from '@/modules/database/index.js';
import {
  broadcastSessionUpserted,
  broadcastSessionUpsertedBatch,
} from '@/modules/websocket/services/session-upsert-broadcast.service.js';
import { connectedClients } from '@/modules/websocket/services/websocket-state.service.js';

class FakeConnection {
  readyState = 1; // WS_OPEN_STATE
  frames: Array<Record<string, unknown>> = [];

  send(data: string): void {
    this.frames.push(JSON.parse(data) as Record<string, unknown>);
  }
}

async function withIsolatedDatabase(runTest: () => void | Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'session-upsert-broadcast-'));

  closeConnection();
  process.env.DATABASE_PATH = path.join(tempDirectory, 'auth.db');
  await initializeDatabase();

  try {
    await runTest();
  } finally {
    connectedClients.clear();
    closeConnection();
    if (previousDatabasePath === undefined) {
      delete process.env.DATABASE_PATH;
    } else {
      process.env.DATABASE_PATH = previousDatabasePath;
    }
    await rm(tempDirectory, { recursive: true, force: true });
  }
}

test('an upsert always carries the provider session id', async () => {
  await withIsolatedDatabase(async () => {
    sessionsDb.createAppSession('app-1', 'opencode', '/workspace/demo');
    sessionsDb.assignProviderSessionId('app-1', 'native-1');

    const connection = new FakeConnection();
    connectedClients.add(connection as never);

    await broadcastSessionUpserted('app-1');

    assert.equal(connection.frames.length, 1);
    assert.equal(connection.frames[0].kind, 'session_upserted');
    assert.equal(connection.frames[0].sessionId, 'app-1');
    assert.equal(connection.frames[0].providerSessionId, 'native-1');
  });
});

test('the watcher path resolves a provider-native id to the same canonical event', async () => {
  await withIsolatedDatabase(async () => {
    sessionsDb.createAppSession('app-2', 'opencode', '/workspace/demo');
    sessionsDb.assignProviderSessionId('app-2', 'native-2');

    const connection = new FakeConnection();
    connectedClients.add(connection as never);

    // The sessions watcher only ever knows the id written in the transcript.
    await broadcastSessionUpsertedBatch(['native-2']);

    assert.equal(connection.frames.length, 1);
    assert.equal(connection.frames[0].sessionId, 'app-2');
    assert.equal(connection.frames[0].providerSessionId, 'native-2');
  });
});

test('a session with no provider id yet reports null rather than omitting the field', async () => {
  await withIsolatedDatabase(async () => {
    sessionsDb.createAppSession('app-3', 'claude', '/workspace/demo');

    const connection = new FakeConnection();
    connectedClients.add(connection as never);

    await broadcastSessionUpserted('app-3');

    assert.equal(connection.frames.length, 1);
    assert.ok('providerSessionId' in connection.frames[0]);
    assert.equal(connection.frames[0].providerSessionId, null);
  });
});

test('an unresolvable id broadcasts nothing', async () => {
  await withIsolatedDatabase(async () => {
    const connection = new FakeConnection();
    connectedClients.add(connection as never);

    await broadcastSessionUpserted('does-not-exist');
    await broadcastSessionUpsertedBatch(['also-missing']);

    assert.deepEqual(connection.frames, []);
  });
});

test('a batch delivers every resolvable session and skips the rest', async () => {
  await withIsolatedDatabase(async () => {
    sessionsDb.createAppSession('app-4', 'claude', '/workspace/demo');
    sessionsDb.createAppSession('app-5', 'claude', '/workspace/demo');

    const connection = new FakeConnection();
    connectedClients.add(connection as never);

    await broadcastSessionUpsertedBatch(['app-4', 'missing', 'app-5']);

    assert.deepEqual(
      connection.frames.map((frame) => frame.sessionId),
      ['app-4', 'app-5'],
    );
  });
});

test('a closed socket is skipped', async () => {
  await withIsolatedDatabase(async () => {
    sessionsDb.createAppSession('app-6', 'claude', '/workspace/demo');

    const open = new FakeConnection();
    const closing = new FakeConnection();
    closing.readyState = 3;
    connectedClients.add(open as never);
    connectedClients.add(closing as never);

    await broadcastSessionUpserted('app-6');

    assert.equal(open.frames.length, 1);
    assert.deepEqual(closing.frames, []);
  });
});

// The watcher re-announces a session on every transcript write, including
// rows that are not conversation. Clients take each upsert as new activity
// (attention dot, message reload), so a repeat of the last one is not sent.
test('an upsert identical to the last one sent for that session is not sent again', async () => {
  await withIsolatedDatabase(async () => {
    sessionsDb.createSession('repeat-1', 'claude', '/workspace/demo', 'First title', undefined, '2026-07-10T00:00:00.000Z');

    const connection = new FakeConnection();
    connectedClients.add(connection as never);

    await broadcastSessionUpsertedBatch(['repeat-1']);
    await broadcastSessionUpsertedBatch(['repeat-1']);
    await broadcastSessionUpserted('repeat-1');
    assert.equal(connection.frames.length, 1);

    // A new message (later update time) and a new title are both announced.
    sessionsDb.createSession('repeat-1', 'claude', '/workspace/demo', 'First title', undefined, '2026-07-10T00:05:00.000Z');
    await broadcastSessionUpsertedBatch(['repeat-1']);
    sessionsDb.updateSessionCustomName('repeat-1', 'Renamed');
    await broadcastSessionUpsertedBatch(['repeat-1']);

    assert.deepEqual(
      connection.frames.map((frame) => [
        (frame.session as { lastActivity: string }).lastActivity,
        (frame.session as { summary: string }).summary,
      ]),
      [
        ['2026-07-10T00:00:00.000Z', 'First title'],
        ['2026-07-10T00:05:00.000Z', 'First title'],
        ['2026-07-10T00:05:00.000Z', 'Renamed'],
      ],
    );
  });
});

test('an un-archived session is announced again even if nothing else changed', async () => {
  await withIsolatedDatabase(async () => {
    sessionsDb.createSession('archive-1', 'claude', '/workspace/demo', 'Title', undefined, '2026-07-10T00:00:00.000Z');

    const connection = new FakeConnection();
    connectedClients.add(connection as never);

    await broadcastSessionUpserted('archive-1');
    sessionsDb.updateSessionIsArchived('archive-1', true);
    await broadcastSessionUpserted('archive-1');
    sessionsDb.updateSessionIsArchived('archive-1', false);
    await broadcastSessionUpserted('archive-1');

    assert.equal(connection.frames.length, 2);
  });
});

test('an upsert that reached no open client is sent again', async () => {
  await withIsolatedDatabase(async () => {
    sessionsDb.createSession('unheard-1', 'claude', '/workspace/demo', 'Title', undefined, '2026-07-10T00:00:00.000Z');

    const closing = new FakeConnection();
    closing.readyState = 3;
    connectedClients.add(closing as never);
    await broadcastSessionUpsertedBatch(['unheard-1']);

    const connection = new FakeConnection();
    connectedClients.add(connection as never);
    await broadcastSessionUpsertedBatch(['unheard-1']);

    assert.equal(connection.frames.length, 1);
  });
});

test('archiving or restoring a session forgets its last announcement', async () => {
  await withIsolatedDatabase(async () => {
    const { sessionsService } = await import('@/modules/providers/index.js');
    sessionsDb.createSession('restored-1', 'claude', '/workspace/demo', 'Title', undefined, '2026-07-10T00:00:00.000Z');

    const connection = new FakeConnection();
    connectedClients.add(connection as never);
    await broadcastSessionUpserted('restored-1');

    // Archived and restored with no upsert in between: a client that loaded
    // its list meanwhile does not have the session, so it is announced again.
    await sessionsService.deleteOrArchiveSessionById('restored-1');
    sessionsService.restoreSessionById('restored-1');
    await broadcastSessionUpserted('restored-1');

    assert.equal(connection.frames.length, 2);
  });
});

test('a batch that fails to build marks none of its sessions as announced', async (t) => {
  await withIsolatedDatabase(async () => {
    sessionsDb.createSession('batch-ok', 'claude', '/workspace/demo', 'Title', undefined, '2026-07-10T00:00:00.000Z');
    sessionsDb.createSession('batch-broken', 'claude', '/workspace/broken', 'Title', undefined, '2026-07-10T00:00:00.000Z');

    const connection = new FakeConnection();
    connectedClients.add(connection as never);

    const getProjectPath = projectsDb.getProjectPath.bind(projectsDb);
    const lookup = t.mock.method(projectsDb, 'getProjectPath', (projectPath: string) => {
      if (projectPath === '/workspace/broken') {
        throw new Error('lookup failed');
      }
      return getProjectPath(projectPath);
    });
    await assert.rejects(broadcastSessionUpsertedBatch(['batch-ok', 'batch-broken']));
    lookup.mock.restore();

    await broadcastSessionUpsertedBatch(['batch-ok']);

    assert.deepEqual(connection.frames.map((frame) => frame.sessionId), ['batch-ok']);
  });
});

test('a new provider id or project change is announced even with the same activity and title', async () => {
  await withIsolatedDatabase(async () => {
    sessionsDb.createAppSession('mapped-1', 'claude', '/workspace/demo', 'Title');

    const connection = new FakeConnection();
    connectedClients.add(connection as never);
    await broadcastSessionUpserted('mapped-1');

    sessionsDb.assignProviderSessionId('mapped-1', 'native-mapped-1');
    await broadcastSessionUpserted('mapped-1');
    projectsDb.updateCustomProjectName('/workspace/demo', 'Renamed project');
    await broadcastSessionUpserted('mapped-1');

    assert.deepEqual(
      connection.frames.map((frame) => frame.providerSessionId),
      [null, 'native-mapped-1', 'native-mapped-1'],
    );
    assert.equal((connection.frames[2].project as { displayName: string }).displayName, 'Renamed project');
    const activities = connection.frames.map((frame) => (frame.session as { lastActivity: string }).lastActivity);
    assert.equal(new Set(activities).size, 1);
  });
});

// The recreated project gets a new id, which is part of the announcement.
test('a session deleted with its project is announced again if it comes back unchanged', async () => {
  await withIsolatedDatabase(async () => {
    const { deleteOrArchiveProject } = await import('@/modules/projects/index.js');
    sessionsDb.createSession('project-gone-1', 'claude', '/workspace/gone', 'Title', undefined, '2026-07-10T00:00:00.000Z');

    const connection = new FakeConnection();
    connectedClients.add(connection as never);
    await broadcastSessionUpserted('project-gone-1');

    await deleteOrArchiveProject(projectsDb.getProjectPath('/workspace/gone')!.project_id, true);
    sessionsDb.createSession('project-gone-1', 'claude', '/workspace/gone', 'Title', undefined, '2026-07-10T00:00:00.000Z');
    await broadcastSessionUpserted('project-gone-1');

    assert.equal(connection.frames.length, 2);
  });
});
