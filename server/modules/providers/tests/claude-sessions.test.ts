import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, initializeDatabase, sessionsDb } from '@/modules/database/index.js';
import { ClaudeSessionSynchronizer } from '@/modules/providers/list/claude/claude-session-synchronizer.provider.js';
import { sessionsService } from '@/modules/providers/services/sessions.service.js';

const patchHomeDir = (nextHomeDir: string) => {
  const original = os.homedir;
  (os as any).homedir = () => nextHomeDir;
  return () => {
    (os as any).homedir = original;
  };
};

async function withIsolatedDatabase(runTest: () => void | Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'claude-provider-db-'));
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

/**
 * Writes one Claude transcript. `events` are appended verbatim after the first
 * user turn, mirroring the `custom-title` / `ai-title` / `last-prompt` records
 * the CLI writes at the end of a session file.
 */
const writeClaudeTranscript = async (
  homeDir: string,
  sessionId: string,
  workspacePath: string,
  events: Record<string, unknown>[] = []
): Promise<string> => {
  const projectDir = path.join(homeDir, '.claude', 'projects', workspacePath.replace(/[/\\]/g, '-'));
  await mkdir(projectDir, { recursive: true });

  const lines = [
    JSON.stringify({ type: 'user', sessionId, cwd: workspacePath }),
    ...events.map((event) => JSON.stringify(event)),
  ];

  const filePath = path.join(projectDir, `${sessionId}.jsonl`);
  await writeFile(filePath, `${lines.join('\n')}\n`, 'utf8');
  return filePath;
};

const writeHistory = async (homeDir: string, entries: { sessionId: string; display: string }[]): Promise<void> => {
  await mkdir(path.join(homeDir, '.claude'), { recursive: true });
  await writeFile(
    path.join(homeDir, '.claude', 'history.jsonl'),
    `${entries.map((entry) => JSON.stringify(entry)).join('\n')}\n`,
    'utf8'
  );
};

async function withClaudeHome(prefix: string, runTest: (context: {
  homeDir: string;
  workspacePath: string;
}) => Promise<void>): Promise<void> {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), prefix));
  const workspacePath = path.join(tempRoot, 'workspace');
  await mkdir(workspacePath, { recursive: true });
  const restoreHomeDir = patchHomeDir(tempRoot);

  try {
    await runTest({ homeDir: tempRoot, workspacePath });
  } finally {
    restoreHomeDir();
    await rm(tempRoot, { recursive: true, force: true });
  }
}

test('Claude synchronizer prefers a custom-title event over the history first prompt', { concurrency: false }, async () => {
  await withClaudeHome('claude-session-sync-custom-', async ({ homeDir, workspacePath }) => {
    await writeHistory(homeDir, [{ sessionId: 'claude-1', display: 'first prompt text' }]);
    await writeClaudeTranscript(homeDir, 'claude-1', workspacePath, [
      { type: 'custom-title', customTitle: 'Renamed in the CLI', sessionId: 'claude-1' },
    ]);

    await withIsolatedDatabase(async () => {
      await new ClaudeSessionSynchronizer().synchronize();

      assert.equal(sessionsDb.getSessionById('claude-1')?.custom_name, 'Renamed in the CLI');
    });
  });
});

test('Claude synchronizer replaces a stored name with a newer custom-title', { concurrency: false }, async () => {
  await withClaudeHome('claude-session-sync-rename-', async ({ homeDir, workspacePath }) => {
    await writeHistory(homeDir, [{ sessionId: 'claude-1', display: 'first prompt text' }]);
    await writeClaudeTranscript(homeDir, 'claude-1', workspacePath, [
      { type: 'custom-title', customTitle: 'First name', sessionId: 'claude-1' },
    ]);

    await withIsolatedDatabase(async () => {
      const synchronizer = new ClaudeSessionSynchronizer();
      await synchronizer.synchronize();
      assert.equal(sessionsDb.getSessionById('claude-1')?.custom_name, 'First name');

      // A second /rename appends another event; the newest one must win.
      await writeClaudeTranscript(homeDir, 'claude-1', workspacePath, [
        { type: 'custom-title', customTitle: 'First name', sessionId: 'claude-1' },
        { type: 'custom-title', customTitle: 'Second name', sessionId: 'claude-1' },
      ]);
      await synchronizer.synchronize();

      assert.equal(sessionsDb.getSessionById('claude-1')?.custom_name, 'Second name');
    });
  });
});

test('Claude synchronizer falls back from ai-title to history to last-prompt', { concurrency: false }, async () => {
  await withClaudeHome('claude-session-sync-fallback-', async ({ homeDir, workspacePath }) => {
    await writeHistory(homeDir, [{ sessionId: 'claude-history', display: 'History prompt' }]);
    await writeClaudeTranscript(homeDir, 'claude-ai', workspacePath, [
      { type: 'last-prompt', lastPrompt: 'Ignored last prompt', sessionId: 'claude-ai' },
      { type: 'ai-title', aiTitle: 'Generated title', sessionId: 'claude-ai' },
    ]);
    await writeClaudeTranscript(homeDir, 'claude-history', workspacePath, [
      { type: 'last-prompt', lastPrompt: 'Ignored last prompt', sessionId: 'claude-history' },
    ]);
    await writeClaudeTranscript(homeDir, 'claude-last', workspacePath, [
      { type: 'last-prompt', lastPrompt: 'Only last prompt', sessionId: 'claude-last' },
    ]);
    await writeClaudeTranscript(homeDir, 'claude-none', workspacePath);

    await withIsolatedDatabase(async () => {
      await new ClaudeSessionSynchronizer().synchronize();

      assert.equal(sessionsDb.getSessionById('claude-ai')?.custom_name, 'Generated title');
      assert.equal(sessionsDb.getSessionById('claude-history')?.custom_name, 'History prompt');
      assert.equal(sessionsDb.getSessionById('claude-last')?.custom_name, 'Only last prompt');
      assert.equal(sessionsDb.getSessionById('claude-none')?.custom_name, 'Untitled Claude Session');
    });
  });
});

test('Claude synchronizer skips subagent transcripts', { concurrency: false }, async () => {
  await withClaudeHome('claude-session-sync-subagent-', async ({ homeDir, workspacePath }) => {
    const parentPath = await writeClaudeTranscript(homeDir, 'claude-parent', workspacePath, [
      { type: 'custom-title', customTitle: 'Parent session', sessionId: 'claude-parent' },
    ]);

    // Subagent transcripts repeat the parent sessionId; indexing them would
    // overwrite the parent row's jsonl_path.
    const subagentDir = path.join(path.dirname(parentPath), 'claude-parent', 'subagents');
    await mkdir(subagentDir, { recursive: true });
    await writeFile(
      path.join(subagentDir, 'agent-1.jsonl'),
      `${JSON.stringify({ type: 'user', sessionId: 'claude-parent', cwd: workspacePath })}\n`,
      'utf8'
    );

    await withIsolatedDatabase(async () => {
      const processed = await new ClaudeSessionSynchronizer().synchronize();

      assert.equal(processed, 1);
      assert.equal(sessionsDb.getSessionById('claude-parent')?.jsonl_path, parentPath);
    });
  });
});

test('Renaming a Claude session appends a custom-title event to its transcript', { concurrency: false }, async () => {
  await withClaudeHome('claude-session-rename-', async ({ homeDir, workspacePath }) => {
    await writeHistory(homeDir, [{ sessionId: 'claude-1', display: 'first prompt text' }]);
    const transcriptPath = await writeClaudeTranscript(homeDir, 'claude-1', workspacePath);

    await withIsolatedDatabase(async () => {
      const synchronizer = new ClaudeSessionSynchronizer();
      await synchronizer.synchronize();

      await sessionsService.renameSessionById('claude-1', 'Renamed in the UI');

      const appended = JSON.parse((await readFile(transcriptPath, 'utf8')).trimEnd().split('\n').at(-1)!);
      assert.deepEqual(appended, {
        type: 'custom-title',
        customTitle: 'Renamed in the UI',
        sessionId: 'claude-1',
      });

      // A watcher re-sync racing the append must converge on the same name.
      await synchronizer.synchronizeFile(transcriptPath);
      assert.equal(sessionsDb.getSessionById('claude-1')?.custom_name, 'Renamed in the UI');
    });
  });
});

test('Renaming a Claude session survives a missing transcript file', { concurrency: false }, async () => {
  await withClaudeHome('claude-session-rename-missing-', async ({ homeDir, workspacePath }) => {
    const transcriptPath = await writeClaudeTranscript(homeDir, 'claude-1', workspacePath);

    await withIsolatedDatabase(async () => {
      await new ClaudeSessionSynchronizer().synchronize();
      await rm(transcriptPath);

      const result = await sessionsService.renameSessionById('claude-1', 'Renamed in the UI');

      assert.deepEqual(result, { sessionId: 'claude-1', summary: 'Renamed in the UI' });
      assert.equal(sessionsDb.getSessionById('claude-1')?.custom_name, 'Renamed in the UI');
    });
  });
});

test('Renaming an app-created Claude session uses the provider-native session id', { concurrency: false }, async () => {
  await withClaudeHome('claude-session-rename-app-', async ({ homeDir, workspacePath }) => {
    const transcriptPath = await writeClaudeTranscript(homeDir, 'claude-provider-1', workspacePath);

    await withIsolatedDatabase(async () => {
      sessionsDb.createAppSession('app-1', 'claude', workspacePath);
      sessionsDb.assignProviderSessionId('app-1', 'claude-provider-1');
      await new ClaudeSessionSynchronizer().synchronize();

      await sessionsService.renameSessionById('app-1', 'Renamed in the UI');

      const appended = JSON.parse((await readFile(transcriptPath, 'utf8')).trimEnd().split('\n').at(-1)!);
      assert.equal(appended.sessionId, 'claude-provider-1');
    });
  });
});
