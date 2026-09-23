import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, initializeDatabase, sessionsDb } from '@/modules/database/index.js';
import { ClaudeSessionsProvider } from '@/modules/providers/list/claude/claude-sessions.provider.js';

/**
 * A `claude --resume` lineage keeps one transcript file — named after the
 * newest session id — whose rows still carry the id of the run that wrote
 * them. These fixtures reproduce that exactly: three runs, one file.
 */
const FIRST_RUN_ID = '11111111-1111-4111-8111-111111111111';
const SECOND_RUN_ID = '22222222-2222-4222-8222-222222222222';
const THIRD_RUN_ID = '33333333-3333-4333-8333-333333333333';
const PROJECT_PATH = '/workspace/resumed-project';

async function withIsolatedDatabase(runTest: () => void | Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'claude-resume-db-'));

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

/** Writes `rows` as one JSONL transcript named after `fileSessionId`. */
async function writeTranscript(
  projectDirectory: string,
  fileSessionId: string,
  rows: Record<string, unknown>[],
): Promise<string> {
  const filePath = path.join(projectDirectory, `${fileSessionId}.jsonl`);
  await writeFile(filePath, `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`, 'utf8');
  return filePath;
}

function userRow(
  sessionId: string,
  uuid: string,
  parentUuid: string | null,
  timestamp: string,
  text: string,
): Record<string, unknown> {
  return {
    parentUuid,
    isSidechain: false,
    type: 'user',
    uuid,
    timestamp,
    cwd: PROJECT_PATH,
    sessionId,
    message: { role: 'user', content: text },
  };
}

function assistantRow(
  sessionId: string,
  uuid: string,
  parentUuid: string,
  timestamp: string,
  text: string,
): Record<string, unknown> {
  return {
    parentUuid,
    isSidechain: false,
    type: 'assistant',
    uuid,
    timestamp,
    cwd: PROJECT_PATH,
    sessionId,
    message: { role: 'assistant', model: 'claude-opus-5', content: [{ type: 'text', text }] },
  };
}

/** Three runs chained through `parentUuid`, each writing under its own id. */
function resumedLineageRows(): Record<string, unknown>[] {
  return [
    userRow(FIRST_RUN_ID, 'u1', null, '2026-08-21T10:00:00.000Z', 'first prompt'),
    assistantRow(FIRST_RUN_ID, 'a1', 'u1', '2026-08-21T10:00:05.000Z', 'first answer'),
    userRow(SECOND_RUN_ID, 'u2', 'a1', '2026-08-21T10:10:00.000Z', 'second prompt'),
    assistantRow(SECOND_RUN_ID, 'a2', 'u2', '2026-08-21T10:10:05.000Z', 'second answer'),
    userRow(THIRD_RUN_ID, 'u3', 'a2', '2026-08-21T10:20:00.000Z', 'third prompt'),
    assistantRow(THIRD_RUN_ID, 'a3', 'u3', '2026-08-21T10:20:05.000Z', 'third answer'),
  ];
}

const LINEAGE_TEXTS = [
  'first prompt',
  'first answer',
  'second prompt',
  'second answer',
  'third prompt',
  'third answer',
];

for (const [label, storedProviderSessionId] of [
  ['the newest run id', THIRD_RUN_ID],
  // The disk indexer keys a discovered session off the transcript's *first*
  // row, so an imported lineage is just as likely to be stored under the
  // oldest id as the newest. Either way the file is the conversation.
  ['the oldest run id', FIRST_RUN_ID],
] as const) {
  test(`Claude history returns a resumed session's whole lineage when stored under ${label}`, { concurrency: false }, async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'claude-resume-lineage-'));

    try {
      const jsonlPath = await writeTranscript(tempRoot, THIRD_RUN_ID, resumedLineageRows());

      await withIsolatedDatabase(async () => {
        const now = new Date().toISOString();
        sessionsDb.createSession(
          storedProviderSessionId,
          'claude',
          PROJECT_PATH,
          'Resumed session',
          now,
          now,
          jsonlPath,
        );

        const history = await new ClaudeSessionsProvider().fetchHistory(storedProviderSessionId, {
          providerSessionId: storedProviderSessionId,
        });

        assert.deepEqual(
          history.messages.map((message) => message.content),
          LINEAGE_TEXTS,
          'every run in the lineage belongs to the conversation, in transcript order',
        );
        assert.equal(history.total, LINEAGE_TEXTS.length);
        assert.equal(history.hasMore, false);
      });
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });
}

test('Claude history pages a resumed lineage from its true total', { concurrency: false }, async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'claude-resume-paging-'));

  try {
    const jsonlPath = await writeTranscript(tempRoot, THIRD_RUN_ID, resumedLineageRows());

    await withIsolatedDatabase(async () => {
      const now = new Date().toISOString();
      sessionsDb.createSession(THIRD_RUN_ID, 'claude', PROJECT_PATH, 'Resumed session', now, now, jsonlPath);

      const provider = new ClaudeSessionsProvider();
      const lastPage = await provider.fetchHistory(THIRD_RUN_ID, {
        providerSessionId: THIRD_RUN_ID,
        limit: 2,
        offset: 0,
      });

      assert.deepEqual(lastPage.messages.map((message) => message.content), ['third prompt', 'third answer']);
      assert.equal(lastPage.total, 6);
      assert.equal(lastPage.hasMore, true, 'the pre-resume turns are still reachable');

      // The oldest page is the pre-resume segment — the part that used to be
      // missing entirely.
      const oldestPage = await provider.fetchHistory(THIRD_RUN_ID, {
        providerSessionId: THIRD_RUN_ID,
        limit: 2,
        offset: 4,
      });

      assert.deepEqual(oldestPage.messages.map((message) => message.content), ['first prompt', 'first answer']);
      assert.equal(oldestPage.hasMore, false);
    });
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('Claude history still prunes an edited prompt across a resume boundary', { concurrency: false }, async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'claude-resume-edit-'));

  try {
    // The abandoned prompt was written by the first run and the replacement by
    // the resumed one, so the fork is only visible once both segments are read.
    const rows = [
      userRow(FIRST_RUN_ID, 'u1', null, '2026-08-21T10:00:00.000Z', 'first prompt'),
      assistantRow(FIRST_RUN_ID, 'a1', 'u1', '2026-08-21T10:00:05.000Z', 'first answer'),
      userRow(FIRST_RUN_ID, 'u2-old', 'a1', '2026-08-21T10:10:00.000Z', 'typo prompt'),
      assistantRow(FIRST_RUN_ID, 'a2-old', 'u2-old', '2026-08-21T10:10:05.000Z', 'answer to the typo'),
      userRow(SECOND_RUN_ID, 'u2-new', 'a1', '2026-08-21T10:12:00.000Z', 'corrected prompt'),
      assistantRow(SECOND_RUN_ID, 'a2-new', 'u2-new', '2026-08-21T10:12:05.000Z', 'answer to the correction'),
    ];
    const jsonlPath = await writeTranscript(tempRoot, SECOND_RUN_ID, rows);

    await withIsolatedDatabase(async () => {
      const now = new Date().toISOString();
      sessionsDb.createSession(SECOND_RUN_ID, 'claude', PROJECT_PATH, 'Edited session', now, now, jsonlPath);

      const history = await new ClaudeSessionsProvider().fetchHistory(SECOND_RUN_ID, {
        providerSessionId: SECOND_RUN_ID,
      });

      assert.deepEqual(history.messages.map((message) => message.content), [
        'first prompt',
        'first answer',
        'corrected prompt',
        'answer to the correction',
      ]);
    });
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('Claude history reads one transcript file, never a sibling session in the same project', { concurrency: false }, async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'claude-resume-sibling-'));

  try {
    const jsonlPath = await writeTranscript(tempRoot, THIRD_RUN_ID, resumedLineageRows());
    // An unrelated conversation living in the same project directory.
    await writeTranscript(tempRoot, '44444444-4444-4444-8444-444444444444', [
      userRow('44444444-4444-4444-8444-444444444444', 'x1', null, '2026-08-21T11:00:00.000Z', 'other session prompt'),
    ]);

    await withIsolatedDatabase(async () => {
      const now = new Date().toISOString();
      sessionsDb.createSession(THIRD_RUN_ID, 'claude', PROJECT_PATH, 'Resumed session', now, now, jsonlPath);

      const history = await new ClaudeSessionsProvider().fetchHistory(THIRD_RUN_ID, {
        providerSessionId: THIRD_RUN_ID,
      });

      assert.deepEqual(history.messages.map((message) => message.content), LINEAGE_TEXTS);
    });
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('Claude history shows a row copied into a resumed transcript only once', { concurrency: false }, async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'claude-resume-dupe-'));

  try {
    const rows = resumedLineageRows();
    // A resume that re-copies the rows it inherited writes the same `uuid`
    // twice; rendering both would double the pre-resume turns.
    const jsonlPath = await writeTranscript(tempRoot, THIRD_RUN_ID, [
      ...rows,
      { ...rows[0], sessionId: THIRD_RUN_ID },
      { ...rows[1], sessionId: THIRD_RUN_ID },
    ]);

    await withIsolatedDatabase(async () => {
      const now = new Date().toISOString();
      sessionsDb.createSession(THIRD_RUN_ID, 'claude', PROJECT_PATH, 'Resumed session', now, now, jsonlPath);

      const history = await new ClaudeSessionsProvider().fetchHistory(THIRD_RUN_ID, {
        providerSessionId: THIRD_RUN_ID,
      });

      assert.deepEqual(history.messages.map((message) => message.content), LINEAGE_TEXTS);
    });
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('Claude history leaves a single-run transcript exactly as it was', { concurrency: false }, async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'claude-single-run-'));

  try {
    const rows = [
      userRow(FIRST_RUN_ID, 'u1', null, '2026-08-21T10:00:00.000Z', 'only prompt'),
      assistantRow(FIRST_RUN_ID, 'a1', 'u1', '2026-08-21T10:00:05.000Z', 'only answer'),
    ];
    const jsonlPath = await writeTranscript(tempRoot, FIRST_RUN_ID, rows);

    await withIsolatedDatabase(async () => {
      const now = new Date().toISOString();
      sessionsDb.createSession(FIRST_RUN_ID, 'claude', PROJECT_PATH, 'Plain session', now, now, jsonlPath);

      const history = await new ClaudeSessionsProvider().fetchHistory(FIRST_RUN_ID, {
        providerSessionId: FIRST_RUN_ID,
      });

      assert.deepEqual(history.messages.map((message) => message.content), ['only prompt', 'only answer']);
      assert.equal(history.total, 2);
    });
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('editing a prompt from before a resume finds its anchor in the lineage', { concurrency: false }, async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'claude-resume-anchor-'));

  try {
    const jsonlPath = await writeTranscript(tempRoot, THIRD_RUN_ID, resumedLineageRows());

    await withIsolatedDatabase(async () => {
      const now = new Date().toISOString();
      sessionsDb.createSession(THIRD_RUN_ID, 'claude', PROJECT_PATH, 'Resumed session', now, now, jsonlPath);
      const provider = new ClaudeSessionsProvider();

      // 'u2' was written by the second run, so the old exact-id read could not see it.
      assert.deepEqual(
        await provider.resolveEditAnchor(THIRD_RUN_ID, 'u2'),
        { found: true, resumeThroughId: 'a1' },
        'the edit resumes through the first run\'s answer',
      );
      assert.deepEqual(
        await provider.resolveEditAnchor(THIRD_RUN_ID, 'u1'),
        { found: true, resumeThroughId: null },
        'editing the very first prompt starts the conversation over',
      );
    });
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});
