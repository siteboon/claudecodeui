import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, initializeDatabase, sessionsDb } from '@/modules/database/index.js';
import { AntigravitySessionSynchronizer } from '@/modules/providers/list/antigravity/antigravity-session-synchronizer.provider.js';
import { AntigravitySessionsProvider } from '@/modules/providers/list/antigravity/antigravity-sessions.provider.js';

const patchHomeDir = (nextHomeDir: string) => {
  const original = os.homedir;
  (os as any).homedir = () => nextHomeDir;
  return () => {
    (os as any).homedir = original;
  };
};

async function withIsolatedDatabase(runTest: () => void | Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'antigravity-provider-db-'));
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

const writeAntigravityTranscript = async (
  homeDir: string,
  sessionId: string,
  userMessage = 'Fix Antigravity history',
  assistantMessage = 'History is visible now.',
): Promise<string> => {
  const logsDir = path.join(
    homeDir,
    '.gemini',
    'antigravity-cli',
    'brain',
    sessionId,
    '.system_generated',
    'logs',
  );
  await mkdir(logsDir, { recursive: true });

  const transcriptPath = path.join(logsDir, 'transcript.jsonl');
  const lines = [
    {
      step_index: 0,
      source: 'USER_EXPLICIT',
      type: 'USER_INPUT',
      created_at: '2026-07-17T05:37:32Z',
      content: `<USER_REQUEST>\n${userMessage}\n</USER_REQUEST>\n<ADDITIONAL_METADATA>\nignored\n</ADDITIONAL_METADATA>`,
    },
    {
      step_index: 1,
      source: 'MODEL',
      type: 'PLANNER_RESPONSE',
      created_at: '2026-07-17T05:37:33Z',
      content: assistantMessage,
    },
  ];
  await writeFile(transcriptPath, `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`, 'utf8');
  return transcriptPath;
};

test('Antigravity synchronizer indexes transcript rows from history metadata', { concurrency: false }, async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'antigravity-session-sync-'));
  const workspacePath = path.join(tempRoot, 'workspace');
  const sessionId = 'agy-session-1';
  const restoreHomeDir = patchHomeDir(tempRoot);

  try {
    await mkdir(workspacePath, { recursive: true });
    const transcriptPath = await writeAntigravityTranscript(tempRoot, sessionId);
    const historyPath = path.join(tempRoot, '.gemini', 'antigravity-cli', 'history.jsonl');
    await writeFile(
      historyPath,
      `${JSON.stringify({
        display: 'Fix Antigravity history',
        timestamp: 1784266652000,
        workspace: workspacePath,
        conversationId: sessionId,
      })}\n`,
      'utf8',
    );

    await withIsolatedDatabase(async () => {
      const synchronizer = new AntigravitySessionSynchronizer();
      await synchronizer.synchronize();

      const session = sessionsDb.getSessionById(sessionId);
      assert.equal(session?.provider, 'antigravity');
      assert.equal(session?.provider_session_id, sessionId);
      assert.equal(session?.project_path, workspacePath);
      assert.equal(session?.jsonl_path, transcriptPath);
      assert.equal(session?.custom_name, 'Fix Antigravity history');
    });
  } finally {
    restoreHomeDir();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('Antigravity history reader normalizes transcript messages', async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'antigravity-history-'));
  try {
    const transcriptPath = await writeAntigravityTranscript(tempRoot, 'agy-session-2');
    const provider = new AntigravitySessionsProvider();

    const history = await provider.fetchHistory('app-session-2', {
      providerSessionId: 'agy-session-2',
      jsonlPath: transcriptPath,
    });

    assert.equal(history.total, 2);
    assert.equal(history.messages[0]?.kind, 'text');
    assert.equal(history.messages[0]?.role, 'user');
    assert.equal(history.messages[0]?.content, 'Fix Antigravity history');
    assert.equal(history.messages[1]?.kind, 'text');
    assert.equal(history.messages[1]?.role, 'assistant');
    assert.equal(history.messages[1]?.content, 'History is visible now.');
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});
