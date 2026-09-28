import assert from 'node:assert/strict';
import { appendFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, initializeDatabase, projectsDb, sessionsDb } from '@/modules/database/index.js';
import { providerRegistry } from '@/modules/providers/provider.registry.js';
import { sessionsService } from '@/modules/providers/services/sessions.service.js';
import { chatRunRegistry } from '@/modules/websocket/index.js';
import type { IProvider, IProviderTranscriptRelocation } from '@/shared/interfaces.js';
import type { BackgroundTaskSummary } from '@/shared/types.js';

async function withIsolatedDatabase(runTest: () => void | Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'sessions-service-db-'));

  closeConnection();
  process.env.DATABASE_PATH = path.join(tempDirectory, 'auth.db');
  await initializeDatabase();

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

test('provider session id returns the mapped native id', { concurrency: false }, async () => {
  await withIsolatedDatabase(() => {
    sessionsDb.createAppSession('app-session-id', 'codex', '/tmp/session-id-copy-project');
    sessionsDb.assignProviderSessionId('app-session-id', 'codex-native-session-id');

    assert.equal(sessionsService.getProviderSessionId('app-session-id'), 'codex-native-session-id');
  });
});

test('app session names use at most four whole words from the initial message', { concurrency: false }, async () => {
  await withIsolatedDatabase(() => {
    const result = sessionsService.createAppSession(
      'codex',
      '/tmp/session-name-project',
      '  supercalifragilisticexpialidocious\nsecond   third fourth fifth  ',
    );

    assert.equal(result.sessionName, 'supercalifragilisticexpialidocious second third fourth');
    assert.equal(
      sessionsDb.getSessionById(result.sessionId)?.custom_name,
      'supercalifragilisticexpialidocious second third fourth',
    );
  });
});

test('app sessions without message text receive a stable fallback name', { concurrency: false }, async () => {
  await withIsolatedDatabase(() => {
    const result = sessionsService.createAppSession('claude', '/tmp/attachment-only-project', '  \n ');

    assert.equal(result.sessionName, 'Untitled Session');
    assert.equal(sessionsDb.getSessionById(result.sessionId)?.custom_name, 'Untitled Session');
  });
});

test('provider session id is unavailable until the provider assigns one', { concurrency: false }, async () => {
  await withIsolatedDatabase(() => {
    sessionsDb.createAppSession('pending-app-session', 'claude', '/tmp/session-id-copy-project');

    assert.throws(
      () => sessionsService.getProviderSessionId('pending-app-session'),
      (error: unknown) => {
        const typedError = error as { code?: string; statusCode?: number };
        return typedError.code === 'PROVIDER_SESSION_ID_NOT_AVAILABLE' && typedError.statusCode === 409;
      },
    );
  });
});

test('provider session id reports a missing app session', { concurrency: false }, async () => {
  await withIsolatedDatabase(() => {
    assert.throws(
      () => sessionsService.getProviderSessionId('missing-session'),
      (error: unknown) => {
        const typedError = error as { code?: string; statusCode?: number };
        return typedError.code === 'SESSION_NOT_FOUND' && typedError.statusCode === 404;
      },
    );
  });
});

test('recent sessions map project metadata and preserve database pagination', { concurrency: false }, async () => {
  await withIsolatedDatabase(() => {
    sessionsDb.createSession(
      'older-session',
      'claude',
      '/tmp/recent-project',
      'Older conversation',
      '2026-08-01T08:00:00.000Z',
      '2026-08-01T09:00:00.000Z',
    );
    sessionsDb.createSession(
      'newer-session',
      'codex',
      '/tmp/recent-project',
      'Newer conversation',
      '2026-08-01T10:00:00.000Z',
      '2026-08-01T11:00:00.000Z',
    );
    projectsDb.updateCustomProjectName('/tmp/recent-project', 'Recent Project');

    const project = projectsDb.getProjectPath('/tmp/recent-project');
    const page = sessionsService.listRecentSessions(1, 0);

    assert.deepEqual(page, {
      conversations: [{
        sessionId: 'newer-session',
        provider: 'codex',
        projectId: project?.project_id ?? null,
        projectDisplayName: 'Recent Project',
        sessionTitle: 'Newer conversation',
        lastActivity: '2026-08-01T11:00:00.000Z',
      }],
      total: 2,
      hasMore: true,
    });
  });
});

/** One Claude transcript row of user or assistant text, linked by uuid chain. */
function claudeTextRow(
  sessionId: string,
  role: 'user' | 'assistant',
  text: string,
  ordinal: number,
): Record<string, unknown> {
  return {
    type: role,
    uuid: `row-${ordinal}`,
    parentUuid: ordinal === 0 ? null : `row-${ordinal - 1}`,
    timestamp: new Date(Date.UTC(2026, 0, 1, 0, 0, ordinal)).toISOString(),
    sessionId,
    message: { role, content: [{ type: 'text', text }] },
  };
}

test('history pages are sliced from the cached full transcript and see appended rows', { concurrency: false }, async () => {
  const transcriptDirectory = await mkdtemp(path.join(os.tmpdir(), 'sessions-service-history-'));
  const sessionId = 'claude-history-cache-session';
  const transcriptPath = path.join(transcriptDirectory, `${sessionId}.jsonl`);

  try {
    await withIsolatedDatabase(async () => {
      const rows = [
        claudeTextRow(sessionId, 'user', 'one', 0),
        claudeTextRow(sessionId, 'assistant', 'reply one', 1),
        claudeTextRow(sessionId, 'user', 'two', 2),
        claudeTextRow(sessionId, 'assistant', 'reply two', 3),
      ];
      await writeFile(transcriptPath, `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`, 'utf8');
      sessionsDb.createSession(
        sessionId,
        'claude',
        '/tmp/history-cache-project',
        'History cache conversation',
        '2026-01-01T00:00:00.000Z',
        '2026-01-01T00:00:10.000Z',
        transcriptPath,
      );

      const page = await sessionsService.fetchHistory(sessionId, { limit: 2, offset: 0 });
      assert.equal(page.total, 4);
      assert.equal(page.hasMore, true);
      assert.deepEqual(page.messages.map((message) => message.content), ['two', 'reply two']);

      // A row appended after the page was cached must appear on the next read.
      await appendFile(
        transcriptPath,
        `${JSON.stringify(claudeTextRow(sessionId, 'user', 'three', 4))}\n`,
        'utf8',
      );
      const refreshed = await sessionsService.fetchHistory(sessionId, { limit: 2, offset: 0 });
      assert.equal(refreshed.total, 5);
      assert.deepEqual(refreshed.messages.map((message) => message.content), ['reply two', 'three']);

      // An older page keeps the tail-offset contract while served from cache.
      const older = await sessionsService.fetchHistory(sessionId, { limit: 2, offset: 2 });
      assert.deepEqual(older.messages.map((message) => message.content), ['reply one', 'two']);
      assert.equal(older.hasMore, true);
    });
  } finally {
    await rm(transcriptDirectory, { recursive: true, force: true });
  }
});

test('project transcripts go to each provider that can relocate them and skip the rest', { concurrency: false }, async () => {
  // Claude finds a transcript again from the cwd it resumes in, so it is the
  // provider that has to follow a renamed project folder.
  assert.ok(providerRegistry.resolveProvider('claude').transcriptRelocation);

  const calls: Array<Parameters<IProviderTranscriptRelocation['relocateTranscripts']>[0]> = [];
  const realListProviders = providerRegistry.listProviders;
  providerRegistry.listProviders = () => [
    {
      id: 'claude',
      transcriptRelocation: {
        relocateTranscripts: async (input) => {
          calls.push(input);
          return [{ sessionId: 'claude-session', jsonlPath: '/new/claude-session.jsonl' }];
        },
      },
    } as IProvider,
    { id: 'codex' } as IProvider,
  ];

  try {
    const relocated = await sessionsService.relocateProjectTranscripts({
      sessions: [
        { sessionId: 'claude-session', provider: 'claude', jsonlPath: '/old/claude-session.jsonl' },
        { sessionId: 'codex-session', provider: 'codex', jsonlPath: '/old/rollout.jsonl' },
        { sessionId: 'retired-session', provider: 'retired', jsonlPath: '/old/retired.jsonl' },
      ],
      oldProjectPath: '/old',
      newProjectPath: '/new',
    });

    assert.deepEqual(calls, [{
      sessions: [{ sessionId: 'claude-session', jsonlPath: '/old/claude-session.jsonl' }],
      oldProjectPath: '/old',
      newProjectPath: '/new',
    }]);
    assert.deepEqual(relocated, [{ sessionId: 'claude-session', jsonlPath: '/new/claude-session.jsonl' }]);
  } finally {
    providerRegistry.listProviders = realListProviders;
  }
});

/**
 * Stands in for the provider registry with one provider per id, each with the
 * runtime given — the seam through which a runtime's background work reaches
 * the running-sessions list without an SDK run behind it.
 */
async function withProviders(
  runtimes: Partial<Record<'claude' | 'codex', IProvider['runtime']>>,
  runTest: () => void | Promise<void>,
): Promise<void> {
  const realListProviders = providerRegistry.listProviders;
  providerRegistry.listProviders = () =>
    Object.entries(runtimes).map(([id, runtime]) => ({ id, runtime }) as IProvider);
  try {
    await runTest();
  } finally {
    providerRegistry.listProviders = realListProviders;
    chatRunRegistry.clearAll();
  }
}

const task = (taskId: string, startedAt: number): BackgroundTaskSummary => ({
  taskId,
  toolUseId: `toolu_${taskId}`,
  taskType: 'local_agent',
  description: `Task ${taskId}`,
  startedAt,
});

test('running sessions list a session whose background work outlived its turn', { concurrency: false }, async () => {
  await withIsolatedDatabase(async () => {
    sessionsDb.createAppSession('held-session', 'claude', '/tmp/running-project');
    // The turn ran and completed: the registry still holds the finished run.
    const run = chatRunRegistry.startRun({
      appSessionId: 'held-session', provider: 'claude', providerSessionId: null, connection: null, userId: null,
    });
    assert.ok(run);
    run.writer.send({ kind: 'text', content: 'launched', sessionId: 'held-session', provider: 'claude' });
    run.writer.sendComplete({ exitCode: 0 });
    assert.equal(run.status, 'completed');

    const tasks = [task('late', 2_000), task('early', 1_000)];
    await withProviders(
      { claude: { run: async () => undefined, abort: () => false, listBackgroundWork: () => [{ sessionId: 'held-session', tasks }] } },
      () => {
        assert.deepEqual(sessionsService.listRunningSessions(), [{
          sessionId: 'held-session',
          provider: 'claude',
          startedAt: 1_000,
          lastSeq: run.lastSeq,
          background: true,
          canInterrupt: false,
          tasks,
        }]);
        assert.ok(run.lastSeq > 0, 'the finished run still reports its sequence for replay');
      },
    );
  });
});

test('running sessions carry their tasks on a chat run that is still going', { concurrency: false }, async () => {
  await withIsolatedDatabase(async () => {
    sessionsDb.createAppSession('busy-session', 'claude', '/tmp/running-project');
    sessionsDb.createAppSession('idle-session', 'codex', '/tmp/running-project');
    const run = chatRunRegistry.startRun({
      appSessionId: 'busy-session', provider: 'claude', providerSessionId: null, connection: null, userId: null,
    });
    assert.ok(run);

    const tasks = [task('agent', 5_000)];
    await withProviders(
      {
        claude: { run: async () => undefined, abort: () => false, listBackgroundWork: () => [{ sessionId: 'busy-session', tasks }] },
        // A runtime without background work contributes chat runs alone.
        codex: { run: async () => undefined, abort: () => false },
      },
      () => {
        const sessions = sessionsService.listRunningSessions();
        assert.equal(sessions.length, 1, 'a session with a running chat run is listed once');
        assert.deepEqual(sessions[0], {
          sessionId: 'busy-session',
          provider: 'claude',
          startedAt: run.startedAt,
          lastSeq: 0,
          tasks,
        });
      },
    );
  });
});

test('running sessions with no background work are the chat runs alone', { concurrency: false }, async () => {
  await withIsolatedDatabase(async () => {
    sessionsDb.createAppSession('plain-session', 'codex', '/tmp/running-project');
    const run = chatRunRegistry.startRun({
      appSessionId: 'plain-session', provider: 'codex', providerSessionId: null, connection: null, userId: null,
    });
    assert.ok(run);

    await withProviders(
      { codex: { run: async () => undefined, abort: () => false } },
      () => {
        assert.deepEqual(sessionsService.listRunningSessions(), [{
          sessionId: 'plain-session', provider: 'codex', startedAt: run.startedAt, lastSeq: 0,
        }]);
      },
    );
  });
});
