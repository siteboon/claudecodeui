import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { AppError } from '@/shared/utils/app-error.js';
import { scanStateDb } from '@/shared/database/repositories/scan-state.db.js';
import { sessionsDb } from '@/shared/database/repositories/sessions.db.js';
import { llmSessionsService } from '@/modules/llm/services/sessions.service.js';
import { sessionIndexers } from '@/modules/llm/session-indexers/index.js';
import { conversationSearchService } from '@/modules/conversations/conversation-search.service.js';
import type { ISessionIndexer } from '@/modules/llm/session-indexers/session-indexer.interface.js';

const patchMethod = <T extends object, K extends keyof T>(target: T, key: K, replacement: T[K]) => {
  const original = target[key];
  (target as any)[key] = replacement;
  return () => {
    (target as any)[key] = original;
  };
};

const patchIndexers = (nextIndexers: ISessionIndexer[]) => {
  const originalIndexers = [...sessionIndexers];
  sessionIndexers.splice(0, sessionIndexers.length, ...nextIndexers);
  return () => {
    sessionIndexers.splice(0, sessionIndexers.length, ...originalIndexers);
  };
};

// This test covers multi-provider synchronization orchestration and failure aggregation.
test('llmSessionsService.synchronizeSessions aggregates processed counts and failures', { concurrency: false }, async () => {
  let updateLastScannedAtCalls = 0;
  const restoreScanDate = patchMethod(scanStateDb, 'getLastScannedAt', () => new Date('2026-04-01T00:00:00.000Z'));
  const restoreUpdateScanDate = patchMethod(scanStateDb, 'updateLastScannedAt', () => {
    updateLastScannedAtCalls += 1;
  });
  const restoreIndexers = patchIndexers([
    {
      provider: 'claude',
      async synchronize() {
        return 3;
      },
    },
    {
      provider: 'codex',
      async synchronize() {
        throw new Error('codex index failed');
      },
    },
  ]);

  try {
    const result = await llmSessionsService.synchronizeSessions();
    assert.equal(result.processedByProvider.claude, 3);
    assert.equal(result.processedByProvider.codex, 0);
    assert.equal(result.processedByProvider.cursor, 0);
    assert.equal(result.processedByProvider.gemini, 0);
    assert.equal(result.failures.length, 1);
    assert.equal(result.failures[0], 'codex index failed');
    assert.equal(updateLastScannedAtCalls, 1);
  } finally {
    restoreIndexers();
    restoreUpdateScanDate();
    restoreScanDate();
  }
});

// This test covers provider-specific sync behavior for both incremental and full-rescan modes.
test('llmSessionsService.synchronizeProvider honors fullRescan option', { concurrency: false }, async () => {
  const observedScanDates: Array<Date | null> = [];
  const restoreScanDate = patchMethod(scanStateDb, 'getLastScannedAt', () => new Date('2026-04-02T00:00:00.000Z'));
  const restoreUpdateScanDate = patchMethod(scanStateDb, 'updateLastScannedAt', () => {});
  const restoreIndexers = patchIndexers([
    {
      provider: 'cursor',
      async synchronize(lastScanAt) {
        observedScanDates.push(lastScanAt);
        return 7;
      },
    },
  ]);

  try {
    const incremental = await llmSessionsService.synchronizeProvider('cursor');
    const fullRescan = await llmSessionsService.synchronizeProvider('cursor', { fullRescan: true });

    assert.equal(incremental.provider, 'cursor');
    assert.equal(incremental.processed, 7);
    assert.equal(fullRescan.provider, 'cursor');
    assert.equal(fullRescan.processed, 7);
    assert.equal(observedScanDates.length, 2);
    assert.ok(observedScanDates[0] instanceof Date);
    assert.equal(observedScanDates[1], null);
  } finally {
    restoreIndexers();
    restoreUpdateScanDate();
    restoreScanDate();
  }
});

// This test covers session rename persistence and not-found guardrails.
test('llmSessionsService.updateSessionCustomName validates existence before updating', { concurrency: false }, () => {
  let updated: { sessionId: string; customName: string } | null = null;
  const restoreGetById = patchMethod(sessionsDb, 'getSessionById', (sessionId: string) => (
    sessionId === 'known-session'
      ? {
          session_id: 'known-session',
          provider: 'claude',
          workspace_path: '/tmp/workspace',
          jsonl_path: null,
          created_at: '2026-04-01T00:00:00.000Z',
          updated_at: '2026-04-01T00:00:00.000Z',
        }
      : null
  ));
  const restoreUpdateName = patchMethod(sessionsDb, 'updateSessionCustomName', (sessionId: string, customName: string) => {
    updated = { sessionId, customName };
  });

  try {
    llmSessionsService.updateSessionCustomName('known-session', 'New Session Name');
    assert.deepEqual(updated, {
      sessionId: 'known-session',
      customName: 'New Session Name',
    });

    assert.throws(
      () => llmSessionsService.updateSessionCustomName('missing-session', 'Nope'),
      (error: unknown) =>
        error instanceof AppError &&
        error.code === 'SESSION_NOT_FOUND' &&
        error.statusCode === 404,
    );
  } finally {
    restoreUpdateName();
    restoreGetById();
  }
});

// This test covers delete behavior using only DB jsonl_path, including invalid id validation.
test('llmSessionsService.deleteSessionArtifacts validates ids and deletes disk/db artifacts', { concurrency: false }, async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'llm-delete-session-'));
  const transcriptPath = path.join(tempRoot, 'session.jsonl');
  await fs.writeFile(transcriptPath, '{"ok":true}\n', 'utf8');

  let deletedSessionId: string | null = null;
  const restoreGetById = patchMethod(sessionsDb, 'getSessionById', (sessionId: string) => (
    sessionId === 'session-123'
      ? {
          session_id: 'session-123',
          provider: 'cursor',
          workspace_path: '/tmp/workspace',
          jsonl_path: transcriptPath,
          created_at: '2026-04-01T00:00:00.000Z',
          updated_at: '2026-04-01T00:00:00.000Z',
        }
      : null
  ));
  const restoreDelete = patchMethod(sessionsDb, 'deleteSession', (sessionId: string) => {
    deletedSessionId = sessionId;
  });

  try {
    await assert.rejects(
      llmSessionsService.deleteSessionArtifacts('../invalid'),
      (error: unknown) =>
        error instanceof AppError &&
        error.code === 'INVALID_SESSION_ID' &&
        error.statusCode === 400,
    );

    const deleted = await llmSessionsService.deleteSessionArtifacts('session-123');
    assert.equal(deleted.sessionId, 'session-123');
    assert.equal(deleted.deletedFromDatabase, true);
    assert.equal(deleted.deletedFromDisk, true);
    assert.equal(deletedSessionId, 'session-123');
    await assert.rejects(fs.access(transcriptPath));

    const missing = await llmSessionsService.deleteSessionArtifacts('session-404');
    assert.equal(missing.deletedFromDatabase, false);
    assert.equal(missing.deletedFromDisk, false);
  } finally {
    restoreDelete();
    restoreGetById();
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

// This test covers session-history parsing for JSONL (including malformed lines) and Gemini JSON files.
test('llmSessionsService.getSessionHistory parses JSONL and Gemini JSON correctly', { concurrency: false }, async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'llm-history-'));
  const jsonlPath = path.join(tempRoot, 'session.jsonl');
  const jsonPath = path.join(tempRoot, 'gemini.json');
  await fs.writeFile(jsonlPath, '{"message":"hello"}\nnot-json\n', 'utf8');
  await fs.writeFile(jsonPath, '{"messages":[{"text":"hi"}]}', 'utf8');

  const restoreGetById = patchMethod(sessionsDb, 'getSessionById', (sessionId: string) => {
    if (sessionId === 'jsonl-session') {
      return {
        session_id: 'jsonl-session',
        provider: 'cursor',
        workspace_path: '/tmp/workspace',
        jsonl_path: jsonlPath,
        created_at: '2026-04-01T00:00:00.000Z',
        updated_at: '2026-04-01T00:00:00.000Z',
      };
    }

    if (sessionId === 'json-session') {
      return {
        session_id: 'json-session',
        provider: 'gemini',
        workspace_path: '/tmp/workspace',
        jsonl_path: jsonPath,
        created_at: '2026-04-01T00:00:00.000Z',
        updated_at: '2026-04-01T00:00:00.000Z',
      };
    }

    if (sessionId === 'missing-history-path') {
      return {
        session_id: 'missing-history-path',
        provider: 'claude',
        workspace_path: '/tmp/workspace',
        jsonl_path: null,
        created_at: '2026-04-01T00:00:00.000Z',
        updated_at: '2026-04-01T00:00:00.000Z',
      };
    }

    return null;
  });

  try {
    const jsonlHistory = await llmSessionsService.getSessionHistory('jsonl-session');
    assert.equal(jsonlHistory.fileType, 'jsonl');
    assert.equal(Array.isArray(jsonlHistory.entries), true);
    assert.equal(jsonlHistory.entries.length, 2);
    assert.deepEqual(jsonlHistory.entries[0], { message: 'hello' });
    assert.deepEqual(jsonlHistory.entries[1], { raw: 'not-json', parseError: true });

    const geminiHistory = await llmSessionsService.getSessionHistory('json-session');
    assert.equal(geminiHistory.fileType, 'json');
    assert.equal(geminiHistory.entries.length, 1);
    assert.deepEqual(geminiHistory.entries[0], { messages: [{ text: 'hi' }] });

    await assert.rejects(
      llmSessionsService.getSessionHistory('unknown-session'),
      (error: unknown) =>
        error instanceof AppError &&
        error.code === 'SESSION_NOT_FOUND' &&
        error.statusCode === 404,
    );

    await assert.rejects(
      llmSessionsService.getSessionHistory('missing-history-path'),
      (error: unknown) =>
        error instanceof AppError &&
        error.code === 'SESSION_HISTORY_NOT_AVAILABLE' &&
        error.statusCode === 404,
    );
  } finally {
    restoreGetById();
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

// This test covers conversation search over indexed transcript files with provider/case filters.
test('conversationSearchService searches indexed transcripts with provider and case filters', { concurrency: false }, async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'llm-search-'));
  const cursorPath = path.join(tempRoot, 'cursor.jsonl');
  const codexPath = path.join(tempRoot, 'codex.jsonl');
  await fs.writeFile(cursorPath, 'hello world\nNeedle lower\n', 'utf8');
  await fs.writeFile(codexPath, 'HELLO WORLD\nNEEDLE UPPER\n', 'utf8');

  const restoreGetAll = patchMethod(sessionsDb, 'getAllSessions', () => ([
    {
      session_id: 'cursor-s',
      provider: 'cursor',
      workspace_path: '/tmp/workspace-cursor',
      jsonl_path: cursorPath,
      custom_name: null,
      created_at: '2026-04-01T00:00:00.000Z',
      updated_at: '2026-04-01T00:00:00.000Z',
    },
    {
      session_id: 'codex-s',
      provider: 'codex',
      workspace_path: '/tmp/workspace-codex',
      jsonl_path: codexPath,
      custom_name: null,
      created_at: '2026-04-01T00:00:00.000Z',
      updated_at: '2026-04-01T00:00:00.000Z',
    },
  ]));

  try {
    await assert.rejects(
      conversationSearchService.search({ query: '   ' }),
      (error: unknown) =>
        error instanceof AppError &&
        error.code === 'SEARCH_QUERY_REQUIRED' &&
        error.statusCode === 400,
    );

    const anyProviderResults = await conversationSearchService.search({
      query: 'needle',
      caseSensitive: false,
      limit: 20,
    });
    assert.ok(anyProviderResults.some((entry) => entry.sessionId === 'cursor-s'));
    assert.ok(anyProviderResults.some((entry) => entry.sessionId === 'codex-s'));

    const codexOnlyResults = await conversationSearchService.search({
      query: 'NEEDLE',
      caseSensitive: true,
      provider: 'codex',
      limit: 20,
    });
    assert.ok(codexOnlyResults.length >= 1);
    assert.ok(codexOnlyResults.every((entry) => entry.provider === 'codex'));
  } finally {
    restoreGetAll();
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});
