import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, initializeDatabase, sessionsDb } from '@/modules/database/index.js';
import { QoderSessionSynchronizer } from '@/modules/providers/list/qoder/qoder-session-synchronizer.provider.js';

const synchronizer = new QoderSessionSynchronizer();

async function withIsolatedDatabase(
  runTest: (tempDir: string) => void | Promise<void>,
): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'qoder-sync-test-'));
  closeConnection();
  process.env.DATABASE_PATH = path.join(tempDirectory, 'auth.db');
  await initializeDatabase();
  try {
    await runTest(tempDirectory);
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

async function writeTranscript(filePath: string, lines: unknown[]): Promise<void> {
  const content = lines.map((line) => (line === null ? '' : JSON.stringify(line))).join('\n');
  await writeFile(filePath, content);
}

test('synchronizeFile: title priority is ai-title > first user > last assistant', async () => {
  await withIsolatedDatabase(async (tempDir) => {
    const jsonlPath = path.join(tempDir, 'priority.jsonl');
    await writeTranscript(jsonlPath, [
      { type: 'workspace-directories', sessionId: 's1', directories: ['/proj'] },
      { type: 'user', sessionId: 's1', message: { role: 'user', content: 'first question' } },
      {
        type: 'assistant',
        sessionId: 's1',
        message: { role: 'assistant', content: [{ type: 'text', text: 'first answer' }] },
      },
      {
        type: 'assistant',
        sessionId: 's1',
        message: { role: 'assistant', content: [{ type: 'text', text: 'second answer' }] },
      },
      { type: 'ai-title', sessionId: 's1', aiTitle: 'AI Generated Title' },
    ]);

    const result = await synchronizer.synchronizeFile(jsonlPath);
    assert.equal(result, 's1');
    const row = sessionsDb.getSessionByProviderSessionId('s1');
    assert.equal(row?.custom_name, 'AI Generated Title');
  });
});

test('synchronizeFile: falls back to first user prompt when no ai-title', async () => {
  await withIsolatedDatabase(async (tempDir) => {
    const jsonlPath = path.join(tempDir, 'no-aititle.jsonl');
    await writeTranscript(jsonlPath, [
      { type: 'workspace-directories', sessionId: 's2', directories: ['/proj'] },
      { type: 'user', sessionId: 's2', message: { role: 'user', content: 'my question' } },
      {
        type: 'assistant',
        sessionId: 's2',
        message: { role: 'assistant', content: [{ type: 'text', text: 'my answer' }] },
      },
    ]);

    await synchronizer.synchronizeFile(jsonlPath);
    const row = sessionsDb.getSessionByProviderSessionId('s2');
    assert.equal(row?.custom_name, 'my question');
  });
});

test('synchronizeFile: falls back to last assistant text when no ai-title or user text', async () => {
  await withIsolatedDatabase(async (tempDir) => {
    const jsonlPath = path.join(tempDir, 'fallback.jsonl');
    await writeTranscript(jsonlPath, [
      { type: 'workspace-directories', sessionId: 's3', directories: ['/proj'] },
      {
        type: 'assistant',
        sessionId: 's3',
        message: { role: 'assistant', content: [{ type: 'text', text: 'final answer' }] },
      },
    ]);

    await synchronizer.synchronizeFile(jsonlPath);
    const row = sessionsDb.getSessionByProviderSessionId('s3');
    assert.equal(row?.custom_name, 'final answer');
  });
});

test('synchronizeFile: tolerates blank lines in JSONL', async () => {
  await withIsolatedDatabase(async (tempDir) => {
    const jsonlPath = path.join(tempDir, 'blanks.jsonl');
    await writeTranscript(jsonlPath, [
      null,
      { type: 'workspace-directories', sessionId: 's4', directories: ['/proj'] },
      null,
      { type: 'user', sessionId: 's4', message: { role: 'user', content: 'survives blanks' } },
      null,
    ]);

    await synchronizer.synchronizeFile(jsonlPath);
    const row = sessionsDb.getSessionByProviderSessionId('s4');
    assert.equal(row?.custom_name, 'survives blanks');
  });
});

test('synchronizeFile: skips sidechain sessions tagged with isSidechain', async () => {
  await withIsolatedDatabase(async (tempDir) => {
    const jsonlPath = path.join(tempDir, 'sidechain.jsonl');
    await writeTranscript(jsonlPath, [
      {
        type: 'workspace-directories',
        sessionId: 's5',
        isSidechain: true,
        directories: ['/proj'],
      },
    ]);

    const result = await synchronizer.synchronizeFile(jsonlPath);
    assert.equal(result, null);
    assert.equal(sessionsDb.getSessionByProviderSessionId('s5'), null);
  });
});

test('synchronizeFile: skips sessions tagged with parentUuid', async () => {
  await withIsolatedDatabase(async (tempDir) => {
    const jsonlPath = path.join(tempDir, 'parent.jsonl');
    await writeTranscript(jsonlPath, [
      {
        type: 'workspace-directories',
        sessionId: 's6',
        parentUuid: 'abc-123',
        directories: ['/proj'],
      },
    ]);

    const result = await synchronizer.synchronizeFile(jsonlPath);
    assert.equal(result, null);
    assert.equal(sessionsDb.getSessionByProviderSessionId('s6'), null);
  });
});

test('synchronizeFile: last ai-title wins over earlier ones', async () => {
  await withIsolatedDatabase(async (tempDir) => {
    const jsonlPath = path.join(tempDir, 'multi-aititle.jsonl');
    await writeTranscript(jsonlPath, [
      { type: 'workspace-directories', sessionId: 's7', directories: ['/proj'] },
      { type: 'ai-title', sessionId: 's7', aiTitle: 'First Title' },
      { type: 'ai-title', sessionId: 's7', aiTitle: 'Second Title' },
    ]);

    await synchronizer.synchronizeFile(jsonlPath);
    const row = sessionsDb.getSessionByProviderSessionId('s7');
    assert.equal(row?.custom_name, 'Second Title');
  });
});
