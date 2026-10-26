import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmod, mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import Database from 'better-sqlite3';

import { closeConnection, initializeDatabase, sessionsDb } from '@/modules/database/index.js';
import { spawnCursor } from '@/modules/providers/list/cursor/cursor-runtime.provider.js';
import { CursorSessionSynchronizer } from '@/modules/providers/list/cursor/cursor-session-synchronizer.provider.js';
import { CursorSessionsProvider } from '@/modules/providers/list/cursor/cursor-sessions.provider.js';

const patchHomeDir = (nextHomeDir: string) => {
  const original = os.homedir;
  (os as any).homedir = () => nextHomeDir;
  return () => {
    (os as any).homedir = original;
  };
};

async function withIsolatedDatabase(runTest: () => void | Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'cursor-provider-db-'));
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
 * Runs a test against a temp home holding a real workspace directory. The
 * temp root is resolved because cursor-agent hashes physical paths and the
 * macOS tmpdir is a symlink.
 */
async function withCursorHome(
  prefix: string,
  runTest: (homeDir: string, workspacePath: string) => Promise<void>
): Promise<void> {
  const homeDir = await realpath(await mkdtemp(path.join(os.tmpdir(), prefix)));
  const workspacePath = path.join(homeDir, 'workspace');
  await mkdir(workspacePath, { recursive: true });
  const restoreHomeDir = patchHomeDir(homeDir);

  try {
    await runTest(homeDir, workspacePath);
  } finally {
    restoreHomeDir();
    await rm(homeDir, { recursive: true, force: true });
  }
}

const cursorChatDir = (homeDir: string, workspacePath: string, sessionId: string): string =>
  path.join(homeDir, '.cursor', 'chats', createHash('md5').update(workspacePath).digest('hex'), sessionId);

// Writes the files cursor-agent leaves for one CLI chat: meta.json, store.db
// (with one user message blob) and, optionally, its transcript.
async function writeCursorCliChat(
  homeDir: string,
  workspacePath: string,
  sessionId: string,
  options: { meta?: Record<string, unknown>; firstUserLine?: string; withStore?: boolean } = {}
): Promise<string> {
  const chatDir = cursorChatDir(homeDir, workspacePath, sessionId);
  await mkdir(chatDir, { recursive: true });
  await writeFile(path.join(chatDir, 'meta.json'), JSON.stringify({
    schemaVersion: 1,
    createdAtMs: Date.UTC(2026, 9, 20, 12),
    updatedAtMs: Date.UTC(2026, 9, 21, 12),
    hasConversation: true,
    cwd: workspacePath,
    ...options.meta,
  }), 'utf8');

  if (options.withStore !== false) {
    const db = new Database(path.join(chatDir, 'store.db'));
    try {
      db.exec('CREATE TABLE blobs (id TEXT PRIMARY KEY, data BLOB)');
      const message = { role: 'user', content: [{ type: 'text', text: `<user_query>\n${options.firstUserLine ?? 'Hello'}\n</user_query>` }] };
      db.prepare('INSERT INTO blobs (id, data) VALUES (?, ?)').run('ab'.repeat(32), Buffer.from(JSON.stringify(message)));
    } finally {
      db.close();
    }
  }

  if (options.firstUserLine) {
    const slug = workspacePath.replace(/[^a-zA-Z0-9]/g, '-').replace(/-+/g, '-').replace(/^-+|-+$/g, '');
    const transcriptDir = path.join(homeDir, '.cursor', 'projects', slug, 'agent-transcripts', sessionId);
    await mkdir(transcriptDir, { recursive: true });
    const line = { role: 'user', message: { content: [{ type: 'text', text: `<user_query>\n${options.firstUserLine}\n</user_query>` }] } };
    await writeFile(path.join(transcriptDir, `${sessionId}.jsonl`), `${JSON.stringify(line)}\n`, 'utf8');
  }

  return chatDir;
}

test('Cursor synchronizer indexes CLI chats from their meta.json', { concurrency: false }, async () => {
  await withCursorHome('cursor-sync-cli-', async (homeDir, workspacePath) => {
    const chatDir = await writeCursorCliChat(homeDir, workspacePath, 'cli-chat-1', { firstUserLine: 'Refactor the login flow' });

    await withIsolatedDatabase(async () => {
      const processed = await new CursorSessionSynchronizer().synchronize();

      assert.equal(processed, 1);
      const session = sessionsDb.getSessionById('cli-chat-1');
      assert.equal(session?.project_path, workspacePath);
      assert.equal(session?.custom_name, 'Refactor the login flow');
      assert.equal(session?.jsonl_path, path.join(chatDir, 'store.db'));
    });
  });
});

test('Cursor synchronizer prefers the title cursor-agent stores in meta.json', { concurrency: false }, async () => {
  await withCursorHome('cursor-sync-title-', async (homeDir, workspacePath) => {
    await writeCursorCliChat(homeDir, workspacePath, 'cli-chat-title', {
      meta: { title: 'Named in the CLI' },
      firstUserLine: 'First line',
    });

    await withIsolatedDatabase(async () => {
      await new CursorSessionSynchronizer().synchronize();

      assert.equal(sessionsDb.getSessionById('cli-chat-title')?.custom_name, 'Named in the CLI');
    });
  });
});

test('Cursor synchronizer skips chats cursor-agent itself would not list', { concurrency: false }, async () => {
  await withCursorHome('cursor-sync-skip-', async (homeDir, workspacePath) => {
    await writeCursorCliChat(homeDir, workspacePath, 'no-store', { withStore: false });
    await writeCursorCliChat(homeDir, workspacePath, 'empty-chat', { meta: { hasConversation: false } });
    await writeCursorCliChat(homeDir, workspacePath, 'subagent-chat', { meta: { isSubagent: true } });
    await writeCursorCliChat(homeDir, workspacePath, 'no-cwd', { meta: { cwd: undefined } });

    // A Cursor IDE chat: a transcript under ~/.cursor/projects with no CLI chat store.
    const ideTranscriptDir = path.join(homeDir, '.cursor', 'projects', 'workspace', 'agent-transcripts', 'ide-chat');
    await mkdir(ideTranscriptDir, { recursive: true });
    await writeFile(path.join(ideTranscriptDir, 'ide-chat.jsonl'), '{"role":"user","message":{"content":[]}}\n', 'utf8');

    await withIsolatedDatabase(async () => {
      const processed = await new CursorSessionSynchronizer().synchronize();

      assert.equal(processed, 0);
      for (const sessionId of ['no-store', 'empty-chat', 'subagent-chat', 'no-cwd', 'ide-chat']) {
        assert.equal(sessionsDb.getSessionById(sessionId), null, sessionId);
      }
    });
  });
});

test('Cursor synchronizer finds chats created before the last scan', { concurrency: false }, async () => {
  await withCursorHome('cursor-sync-since-', async (homeDir, workspacePath) => {
    await writeCursorCliChat(homeDir, workspacePath, 'cli-chat-old');

    await withIsolatedDatabase(async () => {
      const processed = await new CursorSessionSynchronizer().synchronize(new Date(Date.now() + 60_000));

      assert.equal(processed, 1);
      assert.ok(sessionsDb.getSessionById('cli-chat-old'));
    });
  });
});

test('Cursor synchronizer re-indexes a chat from its meta.json or store.db', { concurrency: false }, async () => {
  await withCursorHome('cursor-sync-file-', async (homeDir, workspacePath) => {
    const chatDir = await writeCursorCliChat(homeDir, workspacePath, 'cli-chat-watch');

    await withIsolatedDatabase(async () => {
      const synchronizer = new CursorSessionSynchronizer();

      assert.equal(await synchronizer.synchronizeFile(path.join(chatDir, 'store.db-wal')), null);
      assert.equal(await synchronizer.synchronizeFile(path.join(chatDir, 'store.db')), 'cli-chat-watch');
      assert.equal(await synchronizer.synchronizeFile(path.join(chatDir, 'meta.json')), 'cli-chat-watch');
    });
  });
});

test('Cursor synchronizer removes rows an older build indexed from transcripts', { concurrency: false }, async () => {
  await withCursorHome('cursor-sync-stale-', async (homeDir, workspacePath) => {
    const chatDir = await writeCursorCliChat(homeDir, workspacePath, 'cli-chat-kept', { firstUserLine: 'Kept' });
    const transcriptPath = (sessionId: string) => path.join(
      homeDir, '.cursor', 'projects', 'workspace', 'agent-transcripts', sessionId, `${sessionId}.jsonl`
    );
    const ideTranscript = transcriptPath('ide-chat-stale');
    await mkdir(path.dirname(ideTranscript), { recursive: true });
    await writeFile(ideTranscript, '{"role":"user","message":{"content":[]}}\n', 'utf8');

    await withIsolatedDatabase(async () => {
      // Rows as the transcript-based indexer left them: a CLI chat and an IDE chat.
      sessionsDb.createSession('cli-chat-kept', 'cursor', workspacePath, 'Kept', undefined, undefined, transcriptPath('cli-chat-kept'));
      sessionsDb.createSession('ide-chat-stale', 'cursor', workspacePath, 'IDE chat', undefined, undefined, ideTranscript);

      await new CursorSessionSynchronizer().synchronize();

      assert.equal(sessionsDb.getSessionById('cli-chat-kept')?.jsonl_path, path.join(chatDir, 'store.db'));
      assert.equal(sessionsDb.getSessionById('ide-chat-stale'), null);
    });
  });
});

test('Cursor synchronizer keeps transcript rows when a chats directory is unreadable', { concurrency: false, skip: process.platform === 'win32' || process.getuid?.() === 0 }, async () => {
  await withCursorHome('cursor-sync-unreadable-', async (homeDir, workspacePath) => {
    const chatDir = await writeCursorCliChat(homeDir, workspacePath, 'cli-chat-hidden');
    const ideTranscript = path.join(
      homeDir, '.cursor', 'projects', 'workspace', 'agent-transcripts', 'ide-chat-kept', 'ide-chat-kept.jsonl'
    );
    await mkdir(path.dirname(ideTranscript), { recursive: true });
    await writeFile(ideTranscript, '{"role":"user","message":{"content":[]}}\n', 'utf8');

    const workspaceDir = path.dirname(chatDir);
    await chmod(workspaceDir, 0o000);
    try {
      await withIsolatedDatabase(async () => {
        sessionsDb.createSession('ide-chat-kept', 'cursor', workspacePath, 'IDE chat', undefined, undefined, ideTranscript);

        await new CursorSessionSynchronizer().synchronize();

        // The scan couldn't see every chat, so cleanup must not run.
        assert.equal(sessionsDb.getSessionById('ide-chat-kept')?.jsonl_path, ideTranscript);
      });
    } finally {
      await chmod(workspaceDir, 0o755);
    }
  });
});

test('Cursor history loads for a project opened through a symlink', { concurrency: false }, async () => {
  await withCursorHome('cursor-history-link-', async (homeDir, workspacePath) => {
    await writeCursorCliChat(homeDir, workspacePath, 'cli-chat-link', { firstUserLine: 'Linked hello' });
    const linkedPath = path.join(homeDir, 'linked-workspace');
    await symlink(workspacePath, linkedPath);

    const history = await new CursorSessionsProvider().fetchHistory('cli-chat-link', { projectPath: linkedPath });

    assert.equal(history.total, 1);
    assert.equal(history.messages[0]?.content, 'Linked hello');

    // A leftover directory without a store under the resolved hash must not
    // hide the store kept under the path as given.
    await rm(cursorChatDir(homeDir, workspacePath, 'cli-chat-link'), { recursive: true });
    await writeCursorCliChat(homeDir, linkedPath, 'cli-chat-link', { firstUserLine: 'Given path' });
    await mkdir(cursorChatDir(homeDir, workspacePath, 'cli-chat-link'), { recursive: true });

    const givenPathHistory = await new CursorSessionsProvider().fetchHistory('cli-chat-link', { projectPath: linkedPath });
    assert.equal(givenPathHistory.messages[0]?.content, 'Given path');
  });
});

// Empties PATH so a broken guard cannot launch a real cursor-agent, which would
// see the real home directory rather than the patched one.
async function runCursorWithoutBinary(workspacePath: string, providerSessionId: string) {
  const sent: Array<Record<string, any>> = [];
  const ws = { userId: null, send: (message: Record<string, any>) => sent.push(message) };
  const context = {
    resolveProviderSessionId: () => providerSessionId,
    resolveResumeModel: async () => null,
    isProviderInstalled: async () => false,
    normalizeMessage: () => [],
  };

  const previousPath = process.env.PATH;
  process.env.PATH = '';
  try {
    const error = await spawnCursor('Continue please', { sessionId: 'app-session', cwd: workspacePath }, ws, context)
      .then(() => null, (rejection: unknown) => rejection as Error);
    return { error, sent };
  } finally {
    process.env.PATH = previousPath;
  }
}

test('Cursor runtime refuses to resume a session with no CLI chat store', { concurrency: false }, async () => {
  await withCursorHome('cursor-runtime-guard-', async (_homeDir, workspacePath) => {
    await withIsolatedDatabase(async () => {
      const { error, sent } = await runCursorWithoutBinary(workspacePath, 'ide-chat-id');

      assert.match(error?.message ?? '', /cannot be continued/);
      assert.ok(sent.some((message) => message.kind === 'error' && /cannot be continued/.test(message.content)));
    });
  });
});

test('Cursor runtime resumes a session that has a CLI chat store', { concurrency: false }, async () => {
  await withCursorHome('cursor-runtime-resume-', async (homeDir, workspacePath) => {
    await writeCursorCliChat(homeDir, workspacePath, 'cli-chat-resume');

    await withIsolatedDatabase(async () => {
      const { error, sent } = await runCursorWithoutBinary(workspacePath, 'cli-chat-resume');

      // Past the guard, the spawn itself fails because PATH has no cursor-agent.
      assert.ok(error);
      assert.doesNotMatch(error.message, /cannot be continued/);
      assert.ok(!sent.some((message) => /cannot be continued/.test(String(message.content))));
    });
  });
});
