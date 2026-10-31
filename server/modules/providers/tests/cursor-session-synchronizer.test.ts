import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, initializeDatabase, sessionsDb } from '@/modules/database/index.js';
import { CursorSessionSynchronizer } from '@/modules/providers/list/cursor/cursor-session-synchronizer.provider.js';

async function withIsolatedDatabase(runTest: () => void | Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'cursor-sync-db-'));

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

const CURSOR_SESSION_ID = 'cursor-session-1';

/**
 * Lays out the Cursor storage shape `processSessionFile` expects: the chat
 * transcript three levels under `~/.cursor/projects`, with the worker log that
 * names the workspace sitting next to the project directory.
 */
async function writeCursorSession(cursorHome: string): Promise<string> {
  const projectsDir = path.join(cursorHome, 'projects');
  const chatDir = path.join(projectsDir, 'alpha', 'beta');
  await mkdir(chatDir, { recursive: true });

  await writeFile(
    path.join(projectsDir, 'worker.log'),
    '2026-10-28 workspacePath=/workspace/demo\n',
    'utf8',
  );

  const chatPath = path.join(chatDir, `${CURSOR_SESSION_ID}.jsonl`);
  await writeFile(
    chatPath,
    `${JSON.stringify({ role: 'user', message: { content: [{ text: 'first prompt' }] } })}\n`,
    'utf8',
  );
  return chatPath;
}

test('Cursor synchronizeFile keeps an existing sidebar rename over the transcript first prompt', { concurrency: false }, async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'cursor-sync-rename-'));
  const restoreHomeDir = patchHomeDir(tmp);

  try {
    const chatPath = await writeCursorSession(path.join(tmp, '.cursor'));

    await withIsolatedDatabase(async () => {
      // A sidebar rename already named this session; the transcript only
      // offers its first prompt, which is a weaker name.
      sessionsDb.createSession(CURSOR_SESSION_ID, 'cursor', '/workspace/demo', 'Sidebar name');

      const result = await new CursorSessionSynchronizer().synchronizeFile(chatPath);

      assert.ok(result);
      const session = sessionsDb.getSessionById(result);
      assert.equal(session?.custom_name, 'Sidebar name');
    });
  } finally {
    restoreHomeDir();
    await rm(tmp, { recursive: true, force: true });
  }
});

test('Cursor synchronizeFile still names a session from its transcript when the DB has none', { concurrency: false }, async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'cursor-sync-name-'));
  const restoreHomeDir = patchHomeDir(tmp);

  try {
    const chatPath = await writeCursorSession(path.join(tmp, '.cursor'));

    await withIsolatedDatabase(async () => {
      const result = await new CursorSessionSynchronizer().synchronizeFile(chatPath);

      assert.ok(result);
      const session = sessionsDb.getSessionById(result);
      assert.equal(session?.custom_name, 'first prompt');
    });
  } finally {
    restoreHomeDir();
    await rm(tmp, { recursive: true, force: true });
  }
});
