import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, initializeDatabase, sessionsDb } from '@/modules/database/index.js';
import { ClaudeSessionSynchronizer } from '@/modules/providers/list/claude/claude-session-synchronizer.provider.js';

const SESSION_ID = 'duplicate-transcript-session';
const PROJECT_PATH = '/workspace/duplicate-transcript-demo';

async function withIsolatedDatabase(runTest: () => void | Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'claude-duplicate-db-'));

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

const patchHomeDir = (nextHomeDir: string) => {
  const original = os.homedir;
  (os as any).homedir = () => nextHomeDir;
  return () => {
    (os as any).homedir = original;
  };
};

/**
 * The rows every copy of the fixture session shares: a prompt, an assistant
 * turn and the tool call that turn is waiting on. A transcript that ends here
 * is the "hung" one — the tool never comes back.
 */
const TRUNCATED_ROWS = [
  {
    parentUuid: null,
    type: 'user',
    message: { role: 'user', content: 'refactor the parser' },
    uuid: 'row-1',
    timestamp: '2026-09-22T10:00:00.000Z',
    cwd: PROJECT_PATH,
    sessionId: SESSION_ID,
  },
  {
    parentUuid: 'row-1',
    type: 'assistant',
    message: {
      role: 'assistant',
      content: [{ type: 'tool_use', id: 'toolu-1', name: 'Read', input: { file_path: 'a.txt' } }],
      stop_reason: 'tool_use',
    },
    uuid: 'row-2',
    timestamp: '2026-09-22T10:00:05.000Z',
    cwd: PROJECT_PATH,
    sessionId: SESSION_ID,
  },
];

/** The same conversation, carried through to a normal end of turn. */
const COMPLETED_ROWS = [
  ...TRUNCATED_ROWS,
  {
    parentUuid: 'row-2',
    type: 'user',
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu-1', content: 'a' }] },
    uuid: 'row-3',
    timestamp: '2026-09-22T10:00:20.000Z',
    cwd: PROJECT_PATH,
    sessionId: SESSION_ID,
  },
  {
    parentUuid: 'row-3',
    type: 'assistant',
    message: {
      role: 'assistant',
      content: [{ type: 'text', text: 'done' }],
      stop_reason: 'end_turn',
    },
    uuid: 'row-4',
    timestamp: '2026-09-22T10:00:30.000Z',
    cwd: PROJECT_PATH,
    sessionId: SESSION_ID,
  },
];

async function writeTranscript(
  projectDirectory: string,
  rows: Array<Record<string, unknown>>,
  mtimeSeconds = 1_700_000_000,
): Promise<string> {
  await mkdir(projectDirectory, { recursive: true });
  const filePath = path.join(projectDirectory, `${SESSION_ID}.jsonl`);
  await writeFile(filePath, rows.map((row) => JSON.stringify(row)).join('\n') + '\n', 'utf8');
  await utimes(filePath, mtimeSeconds, mtimeSeconds);
  return filePath;
}

/** A claude home with the `projects/` tree and the empty history index sync reads. */
async function createClaudeHome(): Promise<{ home: string; projects: string }> {
  const home = await mkdtemp(path.join(os.tmpdir(), 'claude-duplicate-home-'));
  const claudeHome = path.join(home, '.claude');
  await mkdir(claudeHome, { recursive: true });
  await writeFile(path.join(claudeHome, 'history.jsonl'), '', 'utf8');
  const projects = path.join(claudeHome, 'projects');
  await mkdir(projects, { recursive: true });
  return { home, projects };
}

test('synchronizeFile keeps a session on the transcript copy that is further along', { concurrency: false }, async () => {
  const { home, projects } = await createClaudeHome();
  const restoreHomeDir = patchHomeDir(home);

  try {
    // Same session id in two project directories: what a cwd change mid-session
    // (or tooling copying a transcript to keep `--resume` working) leaves behind.
    const completedPath = await writeTranscript(path.join(projects, '-workspace-demo'), COMPLETED_ROWS);
    // A newer mtime on the stale copy on purpose: `cp -p` preserves the source
    // mtime, so timestamps cannot be trusted to order the two files.
    const truncatedPath = await writeTranscript(
      path.join(projects, '-workspace-demo-copy'),
      TRUNCATED_ROWS,
      1_800_000_000,
    );

    await withIsolatedDatabase(async () => {
      const synchronizer = new ClaudeSessionSynchronizer();

      await synchronizer.synchronizeFile(completedPath);
      const indexed = sessionsDb.getSessionById(SESSION_ID);
      assert.equal(indexed?.jsonl_path, completedPath);
      const indexedUpdatedAt = indexed?.updated_at;

      const result = await synchronizer.synchronizeFile(truncatedPath);

      assert.equal(result, SESSION_ID, 'the stale copy still resolves to its session');
      const session = sessionsDb.getSessionById(SESSION_ID);
      assert.equal(
        session?.jsonl_path,
        completedPath,
        'indexing a copy that stops mid-turn must not repoint the session at it',
      );
      assert.equal(
        session?.updated_at,
        indexedUpdatedAt,
        'the stale copy must not re-date the session either',
      );
    });
  } finally {
    restoreHomeDir();
    await rm(home, { recursive: true, force: true });
  }
});

// Root reads through a 000 mode, so the unreadable-file case cannot be staged.
const runningAsRoot = process.getuid?.() === 0;

test('synchronizeFile keeps the stored transcript when it exists but cannot be read', { concurrency: false, skip: runningAsRoot }, async () => {
  const { home, projects } = await createClaudeHome();
  const restoreHomeDir = patchHomeDir(home);
  const completedPath = await writeTranscript(path.join(projects, '-workspace-demo'), COMPLETED_ROWS);
  const truncatedPath = await writeTranscript(path.join(projects, '-workspace-demo-copy'), TRUNCATED_ROWS);

  try {
    await withIsolatedDatabase(async () => {
      const synchronizer = new ClaudeSessionSynchronizer();
      await synchronizer.synchronizeFile(completedPath);

      // A transient failure (EACCES here; EMFILE or EBUSY in the wild) is not
      // the stored transcript moving away.
      await chmod(completedPath, 0o000);
      await synchronizer.synchronizeFile(truncatedPath);

      assert.equal(sessionsDb.getSessionById(SESSION_ID)?.jsonl_path, completedPath);
    });
  } finally {
    await chmod(completedPath, 0o644);
    restoreHomeDir();
    await rm(home, { recursive: true, force: true });
  }
});

test('synchronizeFile keeps an app-created session on the transcript that is further along', { concurrency: false }, async () => {
  const { home, projects } = await createClaudeHome();
  const restoreHomeDir = patchHomeDir(home);

  try {
    const completedPath = await writeTranscript(path.join(projects, '-workspace-demo'), COMPLETED_ROWS);
    const truncatedPath = await writeTranscript(path.join(projects, '-workspace-demo-copy'), TRUNCATED_ROWS);

    await withIsolatedDatabase(async () => {
      // The common production shape: Chat allocated the row before the
      // provider announced its own id.
      sessionsDb.createAppSession('app-session-1', 'claude', PROJECT_PATH);
      sessionsDb.assignProviderSessionId('app-session-1', SESSION_ID);

      const synchronizer = new ClaudeSessionSynchronizer();
      await synchronizer.synchronizeFile(completedPath);
      const result = await synchronizer.synchronizeFile(truncatedPath);

      assert.equal(result, 'app-session-1', 'the stale copy resolves to the app-facing id');
      assert.equal(sessionsDb.getSessionById('app-session-1')?.jsonl_path, completedPath);
    });
  } finally {
    restoreHomeDir();
    await rm(home, { recursive: true, force: true });
  }
});

test('synchronizeFile follows a transcript copy that is genuinely further along', { concurrency: false }, async () => {
  const { home, projects } = await createClaudeHome();
  const restoreHomeDir = patchHomeDir(home);

  try {
    const truncatedPath = await writeTranscript(path.join(projects, '-workspace-demo'), TRUNCATED_ROWS);
    const completedPath = await writeTranscript(path.join(projects, '-workspace-demo-copy'), COMPLETED_ROWS);

    await withIsolatedDatabase(async () => {
      const synchronizer = new ClaudeSessionSynchronizer();

      await synchronizer.synchronizeFile(truncatedPath);
      assert.equal(sessionsDb.getSessionById(SESSION_ID)?.jsonl_path, truncatedPath);

      await synchronizer.synchronizeFile(completedPath);

      assert.equal(
        sessionsDb.getSessionById(SESSION_ID)?.jsonl_path,
        completedPath,
        'a session whose conversation continued in another file must follow it',
      );
    });
  } finally {
    restoreHomeDir();
    await rm(home, { recursive: true, force: true });
  }
});

test('synchronizeFile breaks a same-timestamp tie on size and keeps the stored file on an exact tie', { concurrency: false }, async () => {
  const { home, projects } = await createClaudeHome();
  const restoreHomeDir = patchHomeDir(home);

  try {
    const storedPath = await writeTranscript(path.join(projects, '-workspace-demo'), TRUNCATED_ROWS);
    // Same last record timestamp as the stored copy, but one extra row that
    // carries no timestamp of its own - the larger file is the fuller one.
    const largerPath = await writeTranscript(path.join(projects, '-workspace-demo-copy'), [
      ...TRUNCATED_ROWS,
      { type: 'last-prompt', lastPrompt: 'refactor the parser', sessionId: SESSION_ID },
    ]);
    const identicalPath = await writeTranscript(path.join(projects, '-workspace-demo-twin'), TRUNCATED_ROWS);

    await withIsolatedDatabase(async () => {
      const synchronizer = new ClaudeSessionSynchronizer();

      await synchronizer.synchronizeFile(storedPath);
      await synchronizer.synchronizeFile(largerPath);
      assert.equal(sessionsDb.getSessionById(SESSION_ID)?.jsonl_path, largerPath);

      await synchronizer.synchronizeFile(identicalPath);
      assert.equal(
        sessionsDb.getSessionById(SESSION_ID)?.jsonl_path,
        largerPath,
        'a byte-identical duplicate must not make the row flap between indexers',
      );
    });
  } finally {
    restoreHomeDir();
    await rm(home, { recursive: true, force: true });
  }
});

test('synchronizeFile adopts a new transcript once the stored one is gone', { concurrency: false }, async () => {
  const { home, projects } = await createClaudeHome();
  const restoreHomeDir = patchHomeDir(home);

  try {
    const movedFromPath = await writeTranscript(path.join(projects, '-workspace-demo'), COMPLETED_ROWS);
    const movedToPath = await writeTranscript(path.join(projects, '-workspace-demo-copy'), TRUNCATED_ROWS);

    await withIsolatedDatabase(async () => {
      const synchronizer = new ClaudeSessionSynchronizer();

      await synchronizer.synchronizeFile(movedFromPath);
      assert.equal(sessionsDb.getSessionById(SESSION_ID)?.jsonl_path, movedFromPath);

      await rm(movedFromPath);
      await synchronizer.synchronizeFile(movedToPath);

      assert.equal(
        sessionsDb.getSessionById(SESSION_ID)?.jsonl_path,
        movedToPath,
        'a transcript that really moved must not leave the row pinned to a deleted file',
      );
    });
  } finally {
    restoreHomeDir();
    await rm(home, { recursive: true, force: true });
  }
});

test('synchronize picks the same transcript copy whichever order the scan walks them in', { concurrency: false }, async () => {
  for (const truncatedDirectoryName of ['-workspace-aaa-copy', '-workspace-zzz-copy']) {
    const { home, projects } = await createClaudeHome();
    const restoreHomeDir = patchHomeDir(home);

    try {
      const completedPath = await writeTranscript(path.join(projects, '-workspace-mmm'), COMPLETED_ROWS);
      await writeTranscript(path.join(projects, truncatedDirectoryName), TRUNCATED_ROWS);

      await withIsolatedDatabase(async () => {
        const synchronizer = new ClaudeSessionSynchronizer();

        await synchronizer.synchronize();

        assert.equal(
          sessionsDb.getSessionById(SESSION_ID)?.jsonl_path,
          completedPath,
          `scan order (${truncatedDirectoryName}) must not decide which copy a session renders`,
        );
      });
    } finally {
      restoreHomeDir();
      await rm(home, { recursive: true, force: true });
    }
  }
});
