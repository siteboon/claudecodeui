import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, initializeDatabase, sessionsDb } from '@/modules/database/index.js';
import { ClaudeSessionsProvider } from '@/modules/providers/list/claude/claude-sessions.provider.js';

const SESSION_ID = 'queued-command-session';

async function withIsolatedDatabase(runTest: () => void | Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'claude-queued-command-db-'));

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

const at = (second: number) => new Date(Date.UTC(2026, 9, 6, 0, 0, second)).toISOString();

const userRow = (uuid: string, second: number, text: string, parentUuid?: string) => ({
  type: 'user',
  uuid,
  parentUuid: parentUuid ?? null,
  sessionId: SESSION_ID,
  timestamp: at(second),
  message: { role: 'user', content: text },
});

const assistantRow = (uuid: string, parentUuid: string, second: number, text: string) => ({
  type: 'assistant',
  uuid,
  parentUuid,
  sessionId: SESSION_ID,
  timestamp: at(second),
  message: { role: 'assistant', content: [{ type: 'text', text }] },
});

const queuedCommandRow = (
  uuid: string,
  parentUuid: string,
  second: number,
  prompt: string,
  commandMode?: string,
) => ({
  type: 'attachment',
  uuid,
  parentUuid,
  sessionId: SESSION_ID,
  timestamp: at(second),
  attachment: { type: 'queued_command', prompt, ...(commandMode ? { commandMode } : {}) },
});

/** Writes the rows as a transcript, registers the session, and returns its history texts. */
async function readHistoryTexts(rows: unknown[]): Promise<string[]> {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'claude-queued-command-'));

  try {
    const transcriptPath = path.join(tempRoot, `${SESSION_ID}.jsonl`);
    await writeFile(transcriptPath, `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`, 'utf8');

    let texts: string[] = [];
    await withIsolatedDatabase(async () => {
      const now = new Date().toISOString();
      sessionsDb.createSession(SESSION_ID, 'claude', tempRoot, 'Queued command session', now, now, transcriptPath);
      const history = await new ClaudeSessionsProvider().fetchHistory(SESSION_ID, {
        providerSessionId: SESSION_ID,
      });
      texts = history.messages.map((message) => String(message.content));
    });
    return texts;
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

test('history shows a message the model took mid-turn as a user message, in place', { concurrency: false }, async () => {
  const texts = await readHistoryTexts([
    userRow('u1', 0, 'start the job'),
    assistantRow('a1', 'u1', 1, 'working'),
    queuedCommandRow('q1', 'a1', 30, 'one more thing', 'prompt'),
    assistantRow('a2', 'q1', 31, 'noted'),
  ]);

  assert.deepEqual(texts, ['start the job', 'working', 'one more thing', 'noted']);
});

test('history does not show a taken message twice when a user row already carries it', { concurrency: false }, async () => {
  const texts = await readHistoryTexts([
    userRow('u1', 0, 'start the job'),
    assistantRow('a1', 'u1', 1, 'working'),
    queuedCommandRow('q1', 'a1', 30, 'one more thing'),
    userRow('u2', 31, 'one more thing', 'q1'),
    assistantRow('a2', 'u2', 32, 'noted'),
  ]);

  assert.deepEqual(texts, ['start the job', 'working', 'one more thing', 'noted']);
});

test('history keeps two identical taken messages as two', { concurrency: false }, async () => {
  const texts = await readHistoryTexts([
    userRow('u1', 0, 'start the job'),
    queuedCommandRow('q1', 'u1', 10, 'again'),
    queuedCommandRow('q2', 'q1', 20, 'again'),
  ]);

  assert.deepEqual(texts, ['start the job', 'again', 'again']);
});

test('history leaves queued machinery and non-prompt commands out', { concurrency: false }, async () => {
  const texts = await readHistoryTexts([
    userRow('u1', 0, 'start the job'),
    queuedCommandRow('q1', 'u1', 10, '<task-notification>done</task-notification>'),
    queuedCommandRow('q2', 'q1', 11, '<system-reminder>be brief</system-reminder>'),
    queuedCommandRow('q3', 'q2', 12, 'echo hi', 'bash'),
    assistantRow('a1', 'q3', 13, 'working'),
  ]);

  assert.deepEqual(texts, ['start the job', 'working']);
});
