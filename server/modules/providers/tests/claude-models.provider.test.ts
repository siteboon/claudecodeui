import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, getConnection, initializeDatabase, sessionsDb } from '@/modules/database/index.js';
import { ClaudeProviderModels } from '@/modules/providers/list/claude/claude-models.provider.js';

async function withIsolatedDatabase(runTest: () => void | Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'claude-provider-models-db-'));
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

test('getCurrentActiveModel resolves the model from JSONL when the app session id differs from the provider session id', async () => {
  await withIsolatedDatabase(async () => {
    const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'claude-provider-models-jsonl-'));
    try {
      const appSessionId = 'app-1b11e042';
      const providerSessionId = 'provider-8151bd9b';
      const jsonlPath = path.join(tempDirectory, `${providerSessionId}.jsonl`);

      // Mirrors the real on-disk schema: each JSONL event carries the
      // provider-native session id, not the app-facing one.
      await writeFile(
        jsonlPath,
        `${JSON.stringify({
          type: 'assistant',
          sessionId: providerSessionId,
          message: { model: 'claude-sonnet-5' },
        })}\n`,
        'utf8',
      );

      sessionsDb.createAppSession(appSessionId, 'claude', tempDirectory);
      sessionsDb.assignProviderSessionId(appSessionId, providerSessionId);
      getConnection()
        .prepare('UPDATE sessions SET jsonl_path = ? WHERE session_id = ?')
        .run(jsonlPath, appSessionId);

      const provider = new ClaudeProviderModels();
      const activeModel = await provider.getCurrentActiveModel(appSessionId);

      assert.equal(activeModel.model, 'sonnet');
    } finally {
      await rm(tempDirectory, { recursive: true, force: true });
    }
  });
});

test('getCurrentActiveModel maps raw JSONL model ids to catalog aliases', async () => {
  await withIsolatedDatabase(async () => {
    const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'claude-provider-models-jsonl-'));
    try {
      const appSessionId = 'app-alias-test';
      const jsonlPath = path.join(tempDirectory, `${appSessionId}.jsonl`);

      // JSONL transcripts record the raw Anthropic API model id, not the short CLI alias.
      await writeFile(
        jsonlPath,
        `${JSON.stringify({
          type: 'assistant',
          sessionId: appSessionId,
          message: { model: 'claude-opus-4-8' },
        })}\n`,
        'utf8',
      );

      sessionsDb.createAppSession(appSessionId, 'claude', tempDirectory);
      getConnection()
        .prepare('UPDATE sessions SET jsonl_path = ? WHERE session_id = ?')
        .run(jsonlPath, appSessionId);

      const provider = new ClaudeProviderModels();
      const activeModel = await provider.getCurrentActiveModel(appSessionId);

      assert.equal(activeModel.model, 'opus');
    } finally {
      await rm(tempDirectory, { recursive: true, force: true });
    }
  });
});

test('getCurrentActiveModel falls back to the catalog default for an unrecognized raw model id', async () => {
  await withIsolatedDatabase(async () => {
    const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'claude-provider-models-jsonl-'));
    try {
      const appSessionId = 'app-unknown-model';
      const jsonlPath = path.join(tempDirectory, `${appSessionId}.jsonl`);

      await writeFile(
        jsonlPath,
        `${JSON.stringify({
          type: 'assistant',
          sessionId: appSessionId,
          message: { model: 'claude-future-model-9000' },
        })}\n`,
        'utf8',
      );

      sessionsDb.createAppSession(appSessionId, 'claude', tempDirectory);
      getConnection()
        .prepare('UPDATE sessions SET jsonl_path = ? WHERE session_id = ?')
        .run(jsonlPath, appSessionId);

      const provider = new ClaudeProviderModels();
      const activeModel = await provider.getCurrentActiveModel(appSessionId);

      assert.equal(activeModel.model, 'default');
    } finally {
      await rm(tempDirectory, { recursive: true, force: true });
    }
  });
});
