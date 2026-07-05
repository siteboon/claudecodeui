import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, initializeDatabase, sessionsDb } from '@/modules/database/index.js';
import { ClaudeSessionSynchronizer } from '@/modules/providers/list/claude/claude-session-synchronizer.provider.js';

async function withIsolatedClaudeSync(runTest: (tempDirectory: string) => void | Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const previousHome = process.env.HOME;
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'claude-sync-'));

  closeConnection();
  process.env.DATABASE_PATH = path.join(tempDirectory, 'auth.db');
  process.env.HOME = tempDirectory;
  await initializeDatabase();

  try {
    await mkdir(path.join(tempDirectory, '.claude'), { recursive: true });
    await runTest(tempDirectory);
  } finally {
    closeConnection();
    if (previousDatabasePath === undefined) {
      delete process.env.DATABASE_PATH;
    } else {
      process.env.DATABASE_PATH = previousDatabasePath;
    }
    if (previousHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = previousHome;
    }
    await rm(tempDirectory, { recursive: true, force: true });
  }
}

async function writeClaudeTranscript(tempDirectory: string, sessionId: string, lines: unknown[]): Promise<string> {
  const projectDirectory = path.join(tempDirectory, '.claude', 'projects', 'demo');
  await mkdir(projectDirectory, { recursive: true });
  const transcriptPath = path.join(projectDirectory, `${sessionId}.jsonl`);
  await writeFile(
    transcriptPath,
    lines.map((line) => JSON.stringify(line)).join('\n'),
    'utf8'
  );
  return transcriptPath;
}

test('Claude synchronizer does not use last-prompt text as the session title', async () => {
  await withIsolatedClaudeSync(async (tempDirectory) => {
    const transcriptPath = await writeClaudeTranscript(tempDirectory, 'claude-session-1', [
      { type: 'summary', sessionId: 'claude-session-1', cwd: '/workspace/demo' },
      {
        type: 'last-prompt',
        sessionId: 'claude-session-1',
        cwd: '/workspace/demo',
        lastPrompt: 'Please explain our private billing migration plan.',
      },
    ]);

    const synchronizer = new ClaudeSessionSynchronizer();
    await synchronizer.synchronizeFile(transcriptPath);

    assert.equal(sessionsDb.getSessionById('claude-session-1')?.custom_name, 'Untitled Claude Session');
  });
});

test('Claude synchronizer recovers the latest meaningful explicit title', async () => {
  await withIsolatedClaudeSync(async (tempDirectory) => {
    const transcriptPath = await writeClaudeTranscript(tempDirectory, 'claude-session-2', [
      { type: 'summary', sessionId: 'claude-session-2', cwd: '/workspace/demo' },
      {
        type: 'ai-title',
        sessionId: 'claude-session-2',
        cwd: '/workspace/demo',
        aiTitle: 'Billing Migration Review',
      },
      {
        type: 'custom-title',
        sessionId: 'claude-session-2',
        cwd: '/workspace/demo',
        customTitle: 'Untitled Claude Session',
      },
    ]);

    const synchronizer = new ClaudeSessionSynchronizer();
    await synchronizer.synchronizeFile(transcriptPath);

    assert.equal(sessionsDb.getSessionById('claude-session-2')?.custom_name, 'Billing Migration Review');
  });
});
