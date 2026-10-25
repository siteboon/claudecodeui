import assert from 'node:assert/strict';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, initializeDatabase, sessionsDb } from '@/modules/database/index.js';
import { CursorSessionSynchronizer } from '@/modules/providers/list/cursor/cursor-session-synchronizer.provider.js';

const patchHomeDir = (nextHomeDir: string) => {
  const original = os.homedir;
  (os as any).homedir = () => nextHomeDir;
  return () => {
    (os as any).homedir = original;
  };
};

async function withIsolatedDatabase(runTest: () => void | Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'cursor-provider-db-'));
  const databasePath = path.join(tempDirectory, 'auth.db');

  closeConnection();
  process.env.DATABASE_PATH = databasePath;
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

// Mirrors how Cursor names `~/.cursor/projects/<name>` after a workspace path.
const encodeCursorProjectName = (workspacePath: string): string =>
  workspacePath.replace(/^[/\\]+/, '').replace(/[^A-Za-z0-9]/g, '-');

const writeCursorTranscript = async (
  homeDir: string,
  projectName: string,
  sessionId: string,
  firstUserLine: string
): Promise<string> => {
  const transcriptDir = path.join(homeDir, '.cursor', 'projects', projectName, 'agent-transcripts', sessionId);
  await mkdir(transcriptDir, { recursive: true });
  const filePath = path.join(transcriptDir, `${sessionId}.jsonl`);
  const line = {
    role: 'user',
    message: { content: [{ type: 'text', text: `<user_query>\n${firstUserLine}\n</user_query>` }] },
  };
  await writeFile(filePath, `${JSON.stringify(line)}\n`, 'utf8');
  return filePath;
};

test('Cursor synchronizer resolves the workspace from the project folder name when worker.log is missing', { concurrency: false }, async () => {
  // realpath so the encoded name matches the path the resolver walks (macOS tmpdir is a symlink).
  const tempRoot = await realpath(await mkdtemp(path.join(os.tmpdir(), 'cursor-session-sync-')));
  // `my_app-2.0` encodes to `my-app-2-0`; the sibling `my` folder forces the
  // resolver to backtrack out of a matching but wrong prefix.
  const workspacePath = path.join(tempRoot, 'code', 'my_app-2.0');
  await mkdir(workspacePath, { recursive: true });
  await mkdir(path.join(tempRoot, 'code', 'my'), { recursive: true });
  const restoreHomeDir = patchHomeDir(tempRoot);

  try {
    await writeCursorTranscript(tempRoot, encodeCursorProjectName(workspacePath), 'cursor-folder-1', 'Refactor the login flow');

    await withIsolatedDatabase(async () => {
      const processed = await new CursorSessionSynchronizer().synchronize();

      assert.equal(processed, 1);
      const session = sessionsDb.getSessionById('cursor-folder-1');
      assert.equal(session?.project_path, workspacePath);
      assert.equal(session?.custom_name, 'Refactor the login flow');
    });
  } finally {
    restoreHomeDir();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('Cursor synchronizer prefers workspacePath from worker.log when present', { concurrency: false }, async () => {
  const tempRoot = await realpath(await mkdtemp(path.join(os.tmpdir(), 'cursor-session-sync-log-')));
  const loggedWorkspace = path.join(tempRoot, 'logged-workspace');
  await mkdir(loggedWorkspace, { recursive: true });
  const restoreHomeDir = patchHomeDir(tempRoot);

  try {
    const projectName = 'unrelated-folder-name';
    await writeCursorTranscript(tempRoot, projectName, 'cursor-log-1', 'Hello');
    await writeFile(
      path.join(tempRoot, '.cursor', 'projects', projectName, 'worker.log'),
      `[info] Starting worker workspacePath=${loggedWorkspace}\n`,
      'utf8'
    );

    await withIsolatedDatabase(async () => {
      await new CursorSessionSynchronizer().synchronize();

      assert.equal(sessionsDb.getSessionById('cursor-log-1')?.project_path, loggedWorkspace);
    });
  } finally {
    restoreHomeDir();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('Cursor synchronizer skips transcripts whose workspace no longer exists', { concurrency: false }, async () => {
  const tempRoot = await realpath(await mkdtemp(path.join(os.tmpdir(), 'cursor-session-sync-gone-')));
  const restoreHomeDir = patchHomeDir(tempRoot);

  try {
    const deletedWorkspace = path.join(tempRoot, 'deleted-workspace');
    await writeCursorTranscript(tempRoot, encodeCursorProjectName(deletedWorkspace), 'cursor-gone-1', 'Hello');

    await withIsolatedDatabase(async () => {
      const processed = await new CursorSessionSynchronizer().synchronize();

      assert.equal(processed, 0);
      assert.equal(sessionsDb.getSessionById('cursor-gone-1'), null);
    });
  } finally {
    restoreHomeDir();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('Cursor synchronizer does not index nested subagent transcripts via the folder-name fallback', { concurrency: false }, async () => {
  const tempRoot = await realpath(await mkdtemp(path.join(os.tmpdir(), 'cursor-session-sync-sub-')));
  const workspacePath = path.join(tempRoot, 'workspace');
  await mkdir(workspacePath, { recursive: true });
  const restoreHomeDir = patchHomeDir(tempRoot);

  try {
    const projectName = encodeCursorProjectName(workspacePath);
    await writeCursorTranscript(tempRoot, projectName, 'cursor-parent-1', 'Parent task');
    const subagentDir = path.join(
      tempRoot, '.cursor', 'projects', projectName, 'agent-transcripts', 'cursor-parent-1', 'subagents'
    );
    await mkdir(subagentDir, { recursive: true });
    await writeFile(
      path.join(subagentDir, 'cursor-subagent-1.jsonl'),
      `${JSON.stringify({ role: 'user', message: { content: [{ type: 'text', text: 'Subtask' }] } })}\n`,
      'utf8'
    );

    await withIsolatedDatabase(async () => {
      const processed = await new CursorSessionSynchronizer().synchronize();

      assert.equal(processed, 1);
      assert.ok(sessionsDb.getSessionById('cursor-parent-1'));
      assert.equal(sessionsDb.getSessionById('cursor-subagent-1'), null);
    });
  } finally {
    restoreHomeDir();
    await rm(tempRoot, { recursive: true, force: true });
  }
});
