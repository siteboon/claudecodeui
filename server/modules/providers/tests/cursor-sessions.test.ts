import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

import Database from 'better-sqlite3';

import { closeConnection, initializeDatabase, sessionsDb } from '@/modules/database/index.js';
import { spawnCursor } from '@/modules/providers/list/cursor/cursor-runtime.provider.js';
import { CursorSessionSynchronizer } from '@/modules/providers/list/cursor/cursor-session-synchronizer.provider.js';
import { CursorSessionsProvider } from '@/modules/providers/list/cursor/cursor-sessions.provider.js';
import { sessionsService } from '@/modules/providers/services/sessions.service.js';
import { prependCursorContinuedChatTag, toCursorProjectSlug } from '@/shared/utils.js';

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

// ---------------------------------------------------------------------------
// Cursor IDE chats: read-only listing and "continue in CLI"
// ---------------------------------------------------------------------------

// Where the IDE keeps `workspaceStorage`, mirroring the synchronizer's lookup
// under the patched home directory.
function cursorWorkspaceStorageDir(homeDir: string): string {
  if (process.platform === 'darwin') {
    return path.join(homeDir, 'Library', 'Application Support', 'Cursor', 'User', 'workspaceStorage');
  }
  return path.join(homeDir, '.config', 'Cursor', 'User', 'workspaceStorage');
}

// Records a folder as opened in the Cursor IDE, the way `workspace.json` does.
async function writeIdeWorkspace(homeDir: string, storageId: string, folderPath: string): Promise<void> {
  const storageDir = path.join(cursorWorkspaceStorageDir(homeDir), storageId);
  await mkdir(storageDir, { recursive: true });
  await writeFile(path.join(storageDir, 'workspace.json'), JSON.stringify({ folder: pathToFileURL(folderPath).href }), 'utf8');
}

// Writes a Cursor IDE chat transcript: a user turn, then an assistant turn with
// text and a tool call (IDE transcripts never contain tool results).
async function writeIdeTranscript(homeDir: string, workspacePath: string, sessionId: string, firstUserLine: string): Promise<string> {
  const transcriptPath = path.join(
    homeDir, '.cursor', 'projects', toCursorProjectSlug(workspacePath), 'agent-transcripts', sessionId, `${sessionId}.jsonl`
  );
  await mkdir(path.dirname(transcriptPath), { recursive: true });
  const lines = [
    { role: 'user', message: { content: [{ type: 'text', text: `<external_links>\nsome context\n</external_links>\n<user_query>\n${firstUserLine}\n</user_query>` }] } },
    { role: 'assistant', message: { content: [
      { type: 'text', text: 'Looking at the stack.' },
      { type: 'tool_use', name: 'Shell', input: { command: 'ls stacks', description: 'List stacks' } },
    ] } },
  ];
  await writeFile(transcriptPath, `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`, 'utf8');
  return transcriptPath;
}

// Runs a test with XDG_CONFIG_HOME unset, so Linux resolves the IDE's data
// directory under the patched home directory.
async function withoutXdgConfigHome(runTest: () => Promise<void>): Promise<void> {
  const previous = process.env.XDG_CONFIG_HOME;
  delete process.env.XDG_CONFIG_HOME;
  try {
    await runTest();
  } finally {
    if (previous !== undefined) {
      process.env.XDG_CONFIG_HOME = previous;
    }
  }
}

test('Cursor synchronizer lists IDE chats read-only under the folder the IDE opened', { concurrency: false }, async () => {
  await withCursorHome('cursor-ide-index-', async (homeDir, workspacePath) => {
    await writeIdeWorkspace(homeDir, 'storage-1', workspacePath);
    const transcriptPath = await writeIdeTranscript(homeDir, workspacePath, 'ide-chat-1', 'Refactor the VPC stack');

    await withoutXdgConfigHome(() => withIsolatedDatabase(async () => {
      const processed = await new CursorSessionSynchronizer().synchronize();

      assert.equal(processed, 1);
      const session = sessionsDb.getSessionById('ide-chat-1');
      assert.equal(session?.project_path, workspacePath);
      assert.equal(session?.custom_name, 'Refactor the VPC stack');
      assert.equal(session?.jsonl_path, transcriptPath);
      assert.equal(session?.read_only, 1);
      assert.equal(sessionsService.getSessionDetailsById('ide-chat-1').readOnly, true);
    }));
  });
});

test('Cursor synchronizer skips IDE transcripts it cannot place or that belong to a CLI chat', { concurrency: false }, async () => {
  await withCursorHome('cursor-ide-skip-', async (homeDir, workspacePath) => {
    // Two opened folders that encode to the same slug: neither can be trusted.
    const dashed = path.join(homeDir, 'my-app');
    const underscored = path.join(homeDir, 'my_app');
    await mkdir(dashed);
    await mkdir(underscored);
    await writeIdeWorkspace(homeDir, 'storage-dashed', dashed);
    await writeIdeWorkspace(homeDir, 'storage-underscored', underscored);
    await writeIdeTranscript(homeDir, dashed, 'ambiguous-chat', 'Which folder?');

    // A transcript whose id cursor-agent has a chat for: the CLI chat wins.
    await writeIdeWorkspace(homeDir, 'storage-workspace', workspacePath);
    await writeCursorCliChat(homeDir, workspacePath, 'cli-owned-chat', { firstUserLine: 'From the CLI' });

    // A transcript in a folder the IDE never listed.
    await writeIdeTranscript(homeDir, path.join(homeDir, 'unlisted'), 'unlisted-chat', 'Nowhere');

    await withoutXdgConfigHome(() => withIsolatedDatabase(async () => {
      await new CursorSessionSynchronizer().synchronize();

      assert.equal(sessionsDb.getSessionById('ambiguous-chat'), null);
      assert.equal(sessionsDb.getSessionById('unlisted-chat'), null);
      assert.equal(sessionsDb.getSessionById('cli-owned-chat')?.read_only, 0);
      assert.equal(path.basename(sessionsDb.getSessionById('cli-owned-chat')?.jsonl_path ?? ''), 'store.db');
    }));
  });
});

test('Cursor synchronizer indexes an IDE chat from its watched transcript', { concurrency: false }, async () => {
  await withCursorHome('cursor-ide-watch-', async (homeDir, workspacePath) => {
    await writeIdeWorkspace(homeDir, 'storage-1', workspacePath);
    const transcriptPath = await writeIdeTranscript(homeDir, workspacePath, 'ide-chat-watch', 'Watch me');
    const subagentPath = path.join(path.dirname(transcriptPath), 'subagents', 'sub-1.jsonl');
    await mkdir(path.dirname(subagentPath), { recursive: true });
    await writeFile(subagentPath, '{}\n', 'utf8');

    await withoutXdgConfigHome(() => withIsolatedDatabase(async () => {
      const synchronizer = new CursorSessionSynchronizer();

      assert.equal(await synchronizer.synchronizeFile(subagentPath), null);
      assert.equal(await synchronizer.synchronizeFile(transcriptPath), 'ide-chat-watch');
      assert.equal(sessionsDb.getSessionById('ide-chat-watch')?.read_only, 1);
    }));
  });
});

test('Cursor history for an IDE chat is read from its transcript', { concurrency: false }, async () => {
  await withCursorHome('cursor-ide-history-', async (homeDir, workspacePath) => {
    await writeIdeTranscript(homeDir, workspacePath, 'ide-chat-history', 'Show the history');

    const history = await new CursorSessionsProvider().fetchHistory('ide-chat-history', { projectPath: workspacePath });

    assert.deepEqual(
      history.messages.map((message) => [message.kind, message.role ?? null, message.content ?? message.toolName]),
      [
        ['text', 'user', 'Show the history'],
        ['text', 'assistant', 'Looking at the stack.'],
        ['tool_use', null, 'Shell'],
      ],
    );
  });
});

test('Cursor history hides the pointer a continued chat starts with', { concurrency: false }, () => {
  const prompt = prependCursorContinuedChatTag('Pick up where we left off', '/tmp/transcript.jsonl');
  const messages = new CursorSessionsProvider().normalizeCursorBlobs([{
    id: 'blob-1',
    sequence: 0,
    rowid: 0,
    content: { role: 'user', content: [{ type: 'text', text: `<user_query>\n${prompt}\n</user_query>` }] },
  }], 'session-1');

  assert.equal(messages.length, 1);
  assert.equal(messages[0]?.content, 'Pick up where we left off');
});

test('Continuing a read-only session starts a linked chat that points at its transcript once', { concurrency: false }, async () => {
  await withCursorHome('cursor-ide-continue-', async (homeDir, workspacePath) => {
    await writeIdeWorkspace(homeDir, 'storage-1', workspacePath);
    const transcriptPath = await writeIdeTranscript(homeDir, workspacePath, 'ide-chat-continue', 'Original question');

    await withoutXdgConfigHome(() => withIsolatedDatabase(async () => {
      await new CursorSessionSynchronizer().synchronize();

      const continued = await sessionsService.continueReadOnlySession('ide-chat-continue');
      const row = sessionsDb.getSessionById(continued.sessionId);
      assert.equal(row?.provider, 'cursor');
      assert.equal(row?.project_path, workspacePath);
      assert.equal(row?.forked_from_session_id, 'ide-chat-continue');
      assert.equal(row?.provider_session_id, null);
      assert.equal(row?.read_only, 0);
      assert.equal(continued.sessionName, 'Original question (CLI)');

      assert.equal(sessionsService.resolveContinuedTranscriptPath(continued.sessionId), transcriptPath);
      sessionsDb.assignProviderSessionId(continued.sessionId, 'new-cli-chat');
      assert.equal(sessionsService.resolveContinuedTranscriptPath(continued.sessionId), null);

      // The source is untouched, and a writable session cannot be "continued".
      assert.equal(sessionsDb.getSessionById('ide-chat-continue')?.read_only, 1);
      await assert.rejects(
        sessionsService.continueReadOnlySession(continued.sessionId),
        (error: { code?: string }) => error.code === 'SESSION_NOT_READ_ONLY',
      );
    }));
  });
});

test('Cursor runtime starts a continued chat as a new chat pointing at the IDE transcript', {
  concurrency: false,
  skip: process.platform === 'win32' ? 'uses a shell-script stand-in for cursor-agent' : false,
}, async () => {
  await withCursorHome('cursor-runtime-continue-', async (homeDir, workspacePath) => {
    // A stand-in cursor-agent that records its arguments and ends the run.
    const binDir = path.join(homeDir, 'bin');
    const argsFile = path.join(homeDir, 'cursor-agent-args.txt');
    await mkdir(binDir);
    await writeFile(path.join(binDir, 'cursor-agent'), [
      '#!/bin/sh',
      `printf '%s\\n' "$@" > '${argsFile}'`,
      `echo '{"type":"result","subtype":"success","session_id":"new-cli-chat","result":"ok"}'`,
    ].join('\n'), 'utf8');
    await chmod(path.join(binDir, 'cursor-agent'), 0o755);

    const ws = { userId: null, send: () => {} };
    const context = {
      resolveProviderSessionId: () => null,
      resolveContinuedTranscriptPath: () => '/ide/transcript.jsonl',
      resolveResumeModel: async () => null,
      isProviderInstalled: async () => true,
      normalizeMessage: () => [],
    };

    const previousPath = process.env.PATH;
    process.env.PATH = binDir;
    try {
      await spawnCursor('Carry on', { sessionId: 'app-session', cwd: workspacePath }, ws, context);
    } finally {
      process.env.PATH = previousPath;
    }

    const args = await readFile(argsFile, 'utf8');
    assert.doesNotMatch(args, /--resume/);
    assert.match(args, /<continued_cursor_chat>/);
    assert.match(args, /\/ide\/transcript\.jsonl/);
    assert.match(args, /Carry on/);
  });
});
