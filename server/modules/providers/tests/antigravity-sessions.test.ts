import assert from 'node:assert/strict';
import { appendFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import Database from 'better-sqlite3';

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

function encodeWireField(field: number, value: Buffer): Buffer {
  const encodeVarint = (number: number): number[] => {
    const bytes: number[] = [];
    do {
      const byte = number % 128;
      number = Math.floor(number / 128);
      bytes.push(number ? byte | 0x80 : byte);
    } while (number);
    return bytes;
  };
  return Buffer.concat([Buffer.from(encodeVarint(field * 8 + 2)), Buffer.from(encodeVarint(value.length)), value]);
}

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

test('Antigravity history reader resolves the native transcript when the indexed path is missing', { concurrency: false }, async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'antigravity-history-fallback-'));
  const restoreHomeDir = patchHomeDir(tempRoot);
  try {
    await writeAntigravityTranscript(tempRoot, 'agy-session-fallback');
    const provider = new AntigravitySessionsProvider();

    const history = await provider.fetchHistory('app-session-fallback', {
      providerSessionId: 'agy-session-fallback',
      jsonlPath: null,
    });

    assert.equal(history.total, 2);
    assert.equal(history.messages[0]?.content, 'Fix Antigravity history');
    assert.equal(history.messages[1]?.content, 'History is visible now.');
  } finally {
    restoreHomeDir();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('Antigravity history reader skips a partially written JSONL line', async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'antigravity-partial-history-'));
  try {
    const transcriptPath = await writeAntigravityTranscript(tempRoot, 'agy-session-partial');
    await appendFile(transcriptPath, '{"step_index":2,"source":"MODEL"', 'utf8');
    const provider = new AntigravitySessionsProvider();

    const history = await provider.fetchHistory('app-session-partial', {
      providerSessionId: 'agy-session-partial',
      jsonlPath: transcriptPath,
      offset: 1,
      limit: 1,
    });

    assert.equal(history.total, 2);
    assert.equal(history.messages.length, 1);
    assert.equal(history.messages[0]?.content, 'Fix Antigravity history');
    assert.equal(history.offset, 1);
    assert.equal(history.limit, 1);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('Antigravity history restores clipped assistant text and hides the wait control marker', { concurrency: false }, async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'antigravity-native-history-'));
  const restoreHomeDir = patchHomeDir(tempRoot);
  const providerSessionId = 'agy-session-native';
  try {
    const transcriptPath = await writeAntigravityTranscript(tempRoot, providerSessionId);
    const fullContent = 'Intro\n```python\nprint("hello")\n```\nOutro';
    await appendFile(transcriptPath, [
      JSON.stringify({
        step_index: 2,
        source: 'MODEL',
        type: 'PLANNER_RESPONSE',
        content: 'Intro\n```python\n<truncated 22 bytes>\nOutro',
        truncated_fields: ['content'],
      }),
      JSON.stringify({
        step_index: 3,
        source: 'MODEL',
        type: 'PLANNER_RESPONSE',
        content: '<WAITING_FOR_EVENTS>\n</WAITING_FOR_EVENTS>',
      }),
    ].join('\n') + '\n');

    const conversationsDir = path.join(tempRoot, '.gemini', 'antigravity-cli', 'conversations');
    await mkdir(conversationsDir, { recursive: true });
    const db = new Database(path.join(conversationsDir, `${providerSessionId}.db`));
    try {
      db.exec('CREATE TABLE steps (idx INTEGER PRIMARY KEY, step_type INTEGER, step_payload BLOB)');
      db.prepare('INSERT INTO steps (idx, step_type, step_payload) VALUES (?, ?, ?)').run(
        2,
        15,
        encodeWireField(20, encodeWireField(1, Buffer.from(fullContent))),
      );
      db.prepare('INSERT INTO steps (idx, step_type, step_payload) VALUES (?, ?, ?)').run(
        4,
        17,
        encodeWireField(24, encodeWireField(3, encodeWireField(1, Buffer.from('Individual quota reached.')))),
      );
    } finally {
      db.close();
    }

    const history = await new AntigravitySessionsProvider().fetchHistory('app-session-native', {
      providerSessionId,
      jsonlPath: transcriptPath,
    });
    assert.equal(history.total, 4);
    assert.equal(history.messages[2]?.content, fullContent);
    assert.equal(history.messages.some((message) => message.content?.includes('WAITING_FOR_EVENTS')), false);
    assert.equal(history.messages[3]?.kind, 'error');
    assert.equal(history.messages[3]?.content, 'Individual quota reached.');

    const mismatchedDb = new Database(path.join(conversationsDir, `${providerSessionId}.db`));
    try {
      mismatchedDb.prepare('UPDATE steps SET step_payload = ? WHERE idx = 2').run(
        encodeWireField(20, encodeWireField(1, Buffer.from('A different response'))),
      );
    } finally {
      mismatchedDb.close();
    }
    const fallback = await new AntigravitySessionsProvider().fetchHistory('app-session-native', {
      providerSessionId,
      jsonlPath: transcriptPath,
    });
    assert.match(fallback.messages[2]?.content ?? '', /<truncated 22 bytes>/);
  } finally {
    restoreHomeDir();
    await rm(tempRoot, { recursive: true, force: true });
  }
});
