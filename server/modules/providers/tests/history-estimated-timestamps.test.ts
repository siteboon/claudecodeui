import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, initializeDatabase, sessionsDb } from '@/modules/database/index.js';
import { ClaudeSessionsProvider } from '@/modules/providers/list/claude/claude-sessions.provider.js';
import { CursorSessionsProvider } from '@/modules/providers/list/cursor/cursor-sessions.provider.js';

/**
 * #1595: a history row the provider recorded no time for is still given one,
 * because clients order rows by it, but it is the moment the history was
 * read. Such rows are marked so a client that shows times shows none for them
 * instead of "just now".
 */

const SESSION_ID = 'estimated-timestamps-session';

async function withIsolatedDatabase(runTest: () => void | Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'estimated-timestamps-db-'));

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

test('cursor history: every row is marked, since store.db records no times', () => {
  const messages = new CursorSessionsProvider().normalizeCursorBlobs([
    {
      id: 'blob-user',
      sequence: 1,
      rowid: 1,
      content: { role: 'user', content: '<user_query>List the files</user_query>' },
    },
    {
      id: 'blob-assistant',
      sequence: 2,
      rowid: 2,
      content: {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Listing them.' },
          { type: 'tool-call', toolCallId: 'call-1', toolName: 'Shell', args: { command: 'ls' } },
        ],
      },
    },
  ], SESSION_ID);

  assert.deepEqual(messages.map((message) => message.kind), ['text', 'text', 'tool_use']);
  for (const message of messages) {
    assert.equal(message.timestampEstimated, true, `${message.kind} is marked`);
    // Still filled in: the session store sorts and merges by it.
    assert.ok(Number.isFinite(Date.parse(message.timestamp)));
  }
});

test('claude history: only a transcript row without its own time is marked', { concurrency: false }, async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'estimated-timestamps-history-'));

  try {
    const transcriptPath = path.join(tempRoot, `${SESSION_ID}.jsonl`);
    const row = (uuid: string, role: 'user' | 'assistant', text: string, timestamp?: string) => JSON.stringify({
      parentUuid: null,
      isSidechain: false,
      type: role,
      uuid,
      ...(timestamp ? { timestamp } : {}),
      cwd: '/workspace/demo',
      sessionId: SESSION_ID,
      message: { role, content: [{ type: 'text', text }] },
    });
    await writeFile(
      transcriptPath,
      [
        row('user-1', 'user', 'Plan the refactor.', '2026-07-10T00:00:00.000Z'),
        row('asst-1', 'assistant', 'Here is the plan.'),
        row('asst-2', 'assistant', 'Done.', '2026-07-10T00:00:05.000Z'),
        '',
      ].join('\n'),
      'utf8',
    );

    await withIsolatedDatabase(async () => {
      const now = new Date().toISOString();
      sessionsDb.createSession(SESSION_ID, 'claude', tempRoot, 'Estimated timestamps', now, now, transcriptPath);

      const history = await new ClaudeSessionsProvider().fetchHistory(SESSION_ID, {
        providerSessionId: SESSION_ID,
      });

      const byText = new Map(history.messages.map((message) => [message.content, message]));
      assert.equal(byText.get('Plan the refactor.')?.timestampEstimated, undefined);
      assert.equal(byText.get('Done.')?.timestampEstimated, undefined);
      assert.equal(byText.get('Here is the plan.')?.timestampEstimated, true);
      assert.ok(Number.isFinite(Date.parse(byText.get('Here is the plan.')?.timestamp ?? '')));
    });
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('claude live events are not marked: the time they arrived is when they happened', () => {
  const [reply] = new ClaudeSessionsProvider().normalizeMessage(
    { type: 'assistant', uuid: 'live-1', message: { role: 'assistant', content: [{ type: 'text', text: 'Streaming in.' }] } },
    SESSION_ID,
  );

  assert.equal(reply?.kind, 'text');
  assert.equal(reply?.timestampEstimated, undefined);
});
