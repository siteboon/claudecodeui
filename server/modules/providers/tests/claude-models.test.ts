import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, initializeDatabase, sessionsDb } from '@/modules/database/index.js';
import {
  CLAUDE_FALLBACK_MODELS,
  ClaudeProviderModels,
} from '@/modules/providers/list/claude/claude-models.provider.js';

const PROVIDER_SESSION_ID = '77af7791-311d-4f0e-abbf-381f25ed775a';

async function withIsolatedDatabase(runTest: () => void | Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'claude-models-db-'));
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

const writeSessionJsonl = async (dir: string, rows: unknown[]): Promise<string> => {
  const jsonlPath = path.join(dir, `${PROVIDER_SESSION_ID}.jsonl`);
  await writeFile(jsonlPath, `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`, 'utf8');
  return jsonlPath;
};

const registerSession = (jsonlPath: string, projectPath: string): string =>
  sessionsDb.createSession(
    PROVIDER_SESSION_ID,
    'claude',
    projectPath,
    undefined,
    undefined,
    undefined,
    jsonlPath,
  );

test('claude current active model reads the last assistant turn from the transcript', async () => {
  await withIsolatedDatabase(async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'claude-models-test-'));
    try {
      const jsonlPath = await writeSessionJsonl(dir, [
        { type: 'user', sessionId: PROVIDER_SESSION_ID, message: { content: 'hello' } },
        {
          type: 'assistant',
          sessionId: PROVIDER_SESSION_ID,
          message: { model: 'claude-sonnet-4-5', content: [] },
        },
      ]);
      const sessionId = registerSession(jsonlPath, dir);

      const active = await new ClaudeProviderModels().getCurrentActiveModel(sessionId);
      assert.equal(active.model, 'claude-sonnet-4-5');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

test('claude current active model skips synthetic error rows and recovers the real model', async () => {
  await withIsolatedDatabase(async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'claude-models-test-'));
    try {
      // After a 529 the CLI appends assistant rows with model "<synthetic>"
      // (the API-error notice and "No response requested."); the session's real
      // model lives in the last genuine turn before them.
      const jsonlPath = await writeSessionJsonl(dir, [
        { type: 'user', sessionId: PROVIDER_SESSION_ID, message: { content: 'hello' } },
        {
          type: 'assistant',
          sessionId: PROVIDER_SESSION_ID,
          message: { model: 'claude-sonnet-4-5', content: [] },
        },
        {
          type: 'assistant',
          sessionId: PROVIDER_SESSION_ID,
          message: {
            model: '<synthetic>',
            content: [{ type: 'text', text: 'API Error: 529 Overloaded.' }],
          },
        },
        {
          type: 'assistant',
          sessionId: PROVIDER_SESSION_ID,
          message: {
            model: '<synthetic>',
            content: [{ type: 'text', text: 'No response requested.' }],
          },
        },
      ]);
      const sessionId = registerSession(jsonlPath, dir);

      const active = await new ClaudeProviderModels().getCurrentActiveModel(sessionId);
      assert.equal(active.model, 'claude-sonnet-4-5');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

test('claude current active model falls back to the catalog default when every row is synthetic', async () => {
  await withIsolatedDatabase(async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'claude-models-test-'));
    try {
      const jsonlPath = await writeSessionJsonl(dir, [
        {
          type: 'assistant',
          sessionId: PROVIDER_SESSION_ID,
          message: {
            model: '<synthetic>',
            content: [{ type: 'text', text: 'API Error: 529 Overloaded.' }],
          },
        },
      ]);
      const sessionId = registerSession(jsonlPath, dir);

      const active = await new ClaudeProviderModels().getCurrentActiveModel(sessionId);
      assert.equal(active.model, CLAUDE_FALLBACK_MODELS.DEFAULT);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
