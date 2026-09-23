import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection } from '@/modules/database/connection.js';
import { initializeDatabase } from '@/modules/database/init-db.js';
import { sessionsDb } from '@/modules/database/repositories/sessions.db.js';
import { unrecordedPromptsDb } from '@/modules/database/repositories/unrecorded-prompts.db.js';

async function withIsolatedDatabase(runTest: () => void | Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'unrecorded-prompts-db-'));

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

const keptPrompt = (overrides: Partial<Parameters<typeof unrecordedPromptsDb.add>[0]> = {}) => ({
  sessionId: 'app-session',
  provider: 'codex',
  providerSessionId: 'thread-a',
  turnId: 'turn-2',
  text: 'sent at the usage limit',
  imagePaths: ['/uploads/a.png'],
  submittedAt: '2026-09-23T20:27:17.300Z',
  ...overrides,
});

test('kept prompts are listed per transcript, oldest first', async () => {
  await withIsolatedDatabase(() => {
    sessionsDb.createAppSession('app-session', 'codex', '/workspace/demo');
    unrecordedPromptsDb.add(keptPrompt({ text: 'later', submittedAt: '2026-09-23T20:30:00.000Z' }));
    unrecordedPromptsDb.add(keptPrompt());
    unrecordedPromptsDb.add(keptPrompt({ providerSessionId: 'thread-b', text: 'other transcript' }));

    const listed = unrecordedPromptsDb.listForProviderSession('app-session', 'codex', 'thread-a');
    assert.deepEqual(listed.map((prompt) => prompt.text), ['sent at the usage limit', 'later']);
    assert.deepEqual(listed[0], keptPrompt());
  });
});

test('kept prompts go with the session they belong to', async () => {
  await withIsolatedDatabase(() => {
    sessionsDb.createAppSession('app-session', 'codex', '/workspace/demo');
    unrecordedPromptsDb.add(keptPrompt());

    assert.equal(sessionsDb.deleteSessionById('app-session'), true);
    assert.deepEqual(unrecordedPromptsDb.listForProviderSession('app-session', 'codex', 'thread-a'), []);
  });
});
