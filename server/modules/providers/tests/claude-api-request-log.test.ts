import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, initializeDatabase, sessionsDb } from '@/modules/database/index.js';
import { ClaudeSessionsProvider } from '@/modules/providers/list/claude/claude-sessions.provider.js';

const SESSION_ID = 'claude-api-request-log';
const PROMPT = 'create a file and edit it';

async function withIsolatedDatabase(runTest: () => void | Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'claude-api-request-log-db-'));

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

/**
 * One turn as Claude CLI 2.1.301 writes it: each API request is also logged as
 * `api-request-blob` rows that hold copies of the prompt (behind the injected
 * system reminders) and of the tool call. The copies have no uuid or timestamp.
 * Synthetic data only.
 */
const rows = [
  {
    type: 'user', uuid: 'u1', parentUuid: null, sessionId: SESSION_ID,
    timestamp: '2026-10-16T12:48:39.978Z',
    message: { role: 'user', content: PROMPT },
  },
  {
    type: 'api-request-blob', sessionId: SESSION_ID, hash: 'blob-prompt',
    message: {
      role: 'user',
      content: [
        { type: 'text', text: '<system-reminder>\nproject instructions\n</system-reminder>' },
        { type: 'text', text: PROMPT },
      ],
    },
  },
  {
    type: 'api-request-blob', sessionId: SESSION_ID, hash: 'blob-system',
    message: { role: 'system', content: [{ type: 'text', text: 'environment' }] },
  },
  {
    type: 'assistant', uuid: 'a1', parentUuid: 'u1', sessionId: SESSION_ID,
    timestamp: '2026-10-16T12:49:00.557Z',
    message: {
      role: 'assistant',
      model: 'claude-sonnet-5-5',
      content: [{ type: 'tool_use', id: 'toolu_edit', name: 'Edit', input: { file_path: '/tmp/test.txt' } }],
    },
  },
  {
    type: 'user', uuid: 'u2', parentUuid: 'a1', sessionId: SESSION_ID,
    timestamp: '2026-10-16T12:49:00.723Z',
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_edit', content: 'updated' }] },
  },
  {
    type: 'api-request-blob', sessionId: SESSION_ID, hash: 'blob-tool-call',
    message: {
      role: 'assistant',
      content: [{ type: 'tool_use', id: 'toolu_edit', name: 'Edit', input: { file_path: '/tmp/test.txt' } }],
    },
  },
  {
    type: 'assistant', uuid: 'a2', parentUuid: 'u2', sessionId: SESSION_ID,
    timestamp: '2026-10-16T12:49:04.065Z',
    message: { role: 'assistant', model: 'claude-sonnet-5-5', content: [{ type: 'text', text: 'Done.' }] },
  },
];

test('logged API requests do not repeat the prompt or tool call in history', { concurrency: false }, async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'claude-api-request-log-'));

  try {
    const transcriptPath = path.join(tempRoot, `${SESSION_ID}.jsonl`);
    await writeFile(transcriptPath, `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`, 'utf8');

    await withIsolatedDatabase(async () => {
      const now = new Date().toISOString();
      sessionsDb.createSession(SESSION_ID, 'claude', tempRoot, 'API request log', now, now, transcriptPath);

      const history = await new ClaudeSessionsProvider().fetchHistory(SESSION_ID, {
        providerSessionId: SESSION_ID,
      });
      const drawn = history.messages.map((message) =>
        message.kind === 'tool_use' ? `${message.kind}:${message.toolName}` : `${message.kind}:${message.content}`);

      assert.deepEqual(drawn, [
        `text:${PROMPT}`,
        'tool_use:Edit',
        'text:Done.',
      ]);
      assert.equal(history.total, 3);
    });
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});
