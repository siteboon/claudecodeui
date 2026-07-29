import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, initializeDatabase, sessionsDb } from '@/modules/database/index.js';
import { ClaudeSessionSynchronizer } from '@/modules/providers/list/claude/claude-session-synchronizer.provider.js';
import { buildLookupMap } from '@/shared/utils.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const patchHomeDir = (nextHomeDir: string) => {
  const original = os.homedir;
  (os as any).homedir = () => nextHomeDir;
  return () => {
    (os as any).homedir = original;
  };
};

async function withIsolatedDatabase(runTest: () => void | Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'claude-session-sync-'));
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
 * Writes a minimal valid Claude JSONL session file with enough fields for
 * `extractFirstValidJsonlData` to parse `sessionId` and `cwd`.
 */
async function writeSessionJsonl(
  dirPath: string,
  fileName: string,
  lines: string[],
): Promise<string> {
  const filePath = path.join(dirPath, fileName);
  const head = [
    JSON.stringify({ type: 'mode', mode: 'normal', sessionId: 'test-session-1' }),
    JSON.stringify({ type: 'permission-mode', permissionMode: 'default', sessionId: 'test-session-1' }),
    JSON.stringify({
      parentUuid: null,
      isSidechain: false,
      type: 'user',
      message: { role: 'user', content: 'first prompt' },
      uuid: 'msg-1',
      timestamp: '2026-07-10T00:00:00.000Z',
      cwd: '/workspace/demo',
      sessionId: 'test-session-1',
    }),
  ];
  const content = [...head, ...lines, ''].join('\n');
  await writeFile(filePath, content, 'utf8');
  return filePath;
}

// ---------------------------------------------------------------------------
// buildLookupMap
// ---------------------------------------------------------------------------

test('buildLookupMap returns first-seen value when key appears multiple times', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'claude-lookup-'));
  const filePath = path.join(tmp, 'history.jsonl');
  try {
    await writeFile(
      filePath,
      [
        JSON.stringify({ sessionId: 's1', display: 'first-message' }),
        JSON.stringify({ sessionId: 's1', display: 'second-message' }),
        JSON.stringify({ sessionId: 's2', display: 'only-message' }),
      ].join('\n'),
      'utf8',
    );

    const map = await buildLookupMap(filePath, 'sessionId', 'display');

    assert.equal(map.size, 2);
    assert.equal(map.get('s1'), 'first-message');
    assert.equal(map.get('s2'), 'only-message');
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test('buildLookupMap returns empty map for missing file', async () => {
  const map = await buildLookupMap(path.join(os.tmpdir(), 'does-not-exist.jsonl'), 'k', 'v');
  assert.equal(map.size, 0);
});

test('buildLookupMap returns empty map for empty file', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'claude-lookup-'));
  const filePath = path.join(tmp, 'empty.jsonl');
  try {
    await writeFile(filePath, '', 'utf8');
    const map = await buildLookupMap(filePath, 'k', 'v');
    assert.equal(map.size, 0);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test('buildLookupMap skips rows with non-string key or value', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'claude-lookup-'));
  const filePath = path.join(tmp, 'history.jsonl');
  try {
    await writeFile(
      filePath,
      [
        JSON.stringify({ sessionId: 123, display: 'not-a-string-key' }),
        JSON.stringify({ sessionId: 's1', display: 456 }),
        JSON.stringify({ sessionId: 's1', display: 'valid-entry' }),
      ].join('\n'),
      'utf8',
    );

    const map = await buildLookupMap(filePath, 'sessionId', 'display');
    assert.equal(map.size, 1);
    assert.equal(map.get('s1'), 'valid-entry');
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// extractSessionAiTitleFromEnd — tested via synchronizeFile
// ---------------------------------------------------------------------------

test('synchronizeFile uses ai-title from JSONL when no DB custom_name exists', { concurrency: false }, async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'claude-sync-aititle-'));
  const workspacePath = path.join(tmp, 'workspace');
  await mkdir(workspacePath, { recursive: true });
  const restoreHomeDir = patchHomeDir(tmp);

  try {
    // Create ~/.claude/history.jsonl with a competing display name.
    const claudeHome = path.join(tmp, '.claude');
    await mkdir(claudeHome, { recursive: true });
    await writeFile(
      path.join(claudeHome, 'history.jsonl'),
      JSON.stringify({ sessionId: 'test-session-1', display: 'user-first-prompt-from-history' }) + '\n',
      'utf8',
    );

    // Write session JSONL with ai-title before last-prompt.
    await writeSessionJsonl(workspacePath, 'test-session-1.jsonl', [
      JSON.stringify({ type: 'ai-title', aiTitle: 'AI generated title', sessionId: 'test-session-1' }),
      JSON.stringify({
        parentUuid: 'msg-1',
        isSidechain: false,
        message: { role: 'assistant', content: [{ type: 'text', text: 'hello' }] },
        type: 'assistant',
        uuid: 'msg-2',
      }),
      JSON.stringify({ type: 'last-prompt', lastPrompt: 'first prompt', sessionId: 'test-session-1' }),
    ]);

    await withIsolatedDatabase(async () => {
      const synchronizer = new ClaudeSessionSynchronizer();
      const result = await synchronizer.synchronizeFile(
        path.join(workspacePath, 'test-session-1.jsonl'),
      );

      assert.ok(result, 'synchronizeFile should return a session id');
      const session = sessionsDb.getSessionById(result!);
      assert.equal(session?.custom_name, 'AI generated title');
    });
  } finally {
    restoreHomeDir();
    await rm(tmp, { recursive: true, force: true });
  }
});

test('synchronizeFile uses custom-title from JSONL when no DB custom_name and no ai-title', { concurrency: false }, async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'claude-sync-customtitle-'));
  const workspacePath = path.join(tmp, 'workspace');
  await mkdir(workspacePath, { recursive: true });
  const restoreHomeDir = patchHomeDir(tmp);

  try {
    const claudeHome = path.join(tmp, '.claude');
    await mkdir(claudeHome, { recursive: true });
    await writeFile(path.join(claudeHome, 'history.jsonl'), '', 'utf8');

    await writeSessionJsonl(workspacePath, 'test-session-1.jsonl', [
      JSON.stringify({
        parentUuid: 'msg-1',
        isSidechain: false,
        message: { role: 'assistant', content: [{ type: 'text', text: 'done' }] },
        type: 'assistant',
        uuid: 'msg-2',
      }),
      JSON.stringify({ type: 'custom-title', customTitle: 'Renamed via cli', sessionId: 'test-session-1' }),
      JSON.stringify({ type: 'last-prompt', lastPrompt: 'first prompt', sessionId: 'test-session-1' }),
    ]);

    await withIsolatedDatabase(async () => {
      const synchronizer = new ClaudeSessionSynchronizer();
      const result = await synchronizer.synchronizeFile(
        path.join(workspacePath, 'test-session-1.jsonl'),
      );

      assert.ok(result);
      const session = sessionsDb.getSessionById(result!);
      assert.equal(session?.custom_name, 'Renamed via cli');
    });
  } finally {
    restoreHomeDir();
    await rm(tmp, { recursive: true, force: true });
  }
});

test('synchronizeFile falls back to history.jsonl display when JSONL has no title events', { concurrency: false }, async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'claude-sync-fallback-'));
  const workspacePath = path.join(tmp, 'workspace');
  await mkdir(workspacePath, { recursive: true });
  const restoreHomeDir = patchHomeDir(tmp);

  try {
    const claudeHome = path.join(tmp, '.claude');
    await mkdir(claudeHome, { recursive: true });
    await writeFile(
      path.join(claudeHome, 'history.jsonl'),
      JSON.stringify({ sessionId: 'test-session-1', display: 'fallback display name' }) + '\n',
      'utf8',
    );

    // Session JSONL with NO ai-title, custom-title, or last-prompt.
    await writeSessionJsonl(workspacePath, 'test-session-1.jsonl', [
      JSON.stringify({
        parentUuid: 'msg-1',
        isSidechain: false,
        message: { role: 'assistant', content: [{ type: 'text', text: 'done' }] },
        type: 'assistant',
        uuid: 'msg-2',
      }),
    ]);

    await withIsolatedDatabase(async () => {
      const synchronizer = new ClaudeSessionSynchronizer();
      const result = await synchronizer.synchronizeFile(
        path.join(workspacePath, 'test-session-1.jsonl'),
      );

      assert.ok(result);
      const session = sessionsDb.getSessionById(result!);
      assert.equal(session?.custom_name, 'fallback display name');
    });
  } finally {
    restoreHomeDir();
    await rm(tmp, { recursive: true, force: true });
  }
});

test('synchronizeFile falls back to Untitled Claude Session when all sources are empty', { concurrency: false }, async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'claude-sync-untitled-'));
  const workspacePath = path.join(tmp, 'workspace');
  await mkdir(workspacePath, { recursive: true });
  const restoreHomeDir = patchHomeDir(tmp);

  try {
    const claudeHome = path.join(tmp, '.claude');
    await mkdir(claudeHome, { recursive: true });
    await writeFile(path.join(claudeHome, 'history.jsonl'), '', 'utf8');

    // Session JSONL with NO title events at all.
    await writeSessionJsonl(workspacePath, 'test-session-1.jsonl', [
      JSON.stringify({
        parentUuid: 'msg-1',
        isSidechain: false,
        message: { role: 'assistant', content: [{ type: 'text', text: 'done' }] },
        type: 'assistant',
        uuid: 'msg-2',
      }),
    ]);

    await withIsolatedDatabase(async () => {
      const synchronizer = new ClaudeSessionSynchronizer();
      const result = await synchronizer.synchronizeFile(
        path.join(workspacePath, 'test-session-1.jsonl'),
      );

      assert.ok(result);
      const session = sessionsDb.getSessionById(result!);
      assert.equal(session?.custom_name, 'Untitled Claude Session');
    });
  } finally {
    restoreHomeDir();
    await rm(tmp, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Priority: DB custom_name > JSONL title > history.jsonl
// ---------------------------------------------------------------------------

test('synchronizeFile preserves existing DB custom_name regardless of JSONL and history.jsonl', { concurrency: false }, async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'claude-sync-dbwins-'));
  const workspacePath = path.join(tmp, 'workspace');
  await mkdir(workspacePath, { recursive: true });
  const restoreHomeDir = patchHomeDir(tmp);

  try {
    const claudeHome = path.join(tmp, '.claude');
    await mkdir(claudeHome, { recursive: true });
    await writeFile(
      path.join(claudeHome, 'history.jsonl'),
      JSON.stringify({ sessionId: 'test-session-1', display: 'history-display-name' }) + '\n',
      'utf8',
    );

    // Write session JSONL with competing ai-title.
    await writeSessionJsonl(workspacePath, 'test-session-1.jsonl', [
      JSON.stringify({ type: 'ai-title', aiTitle: 'JSONL ai title', sessionId: 'test-session-1' }),
      JSON.stringify({ type: 'last-prompt', lastPrompt: 'first prompt', sessionId: 'test-session-1' }),
    ]);

    await withIsolatedDatabase(async () => {
      // Pre-seed the DB with a custom_name set via CloudCLI sidebar rename.
      sessionsDb.createSession(
        'test-session-1',
        'claude',
        workspacePath,
        'Sidebar custom name',
      );

      const synchronizer = new ClaudeSessionSynchronizer();
      const result = await synchronizer.synchronizeFile(
        path.join(workspacePath, 'test-session-1.jsonl'),
      );

      assert.ok(result);
      const session = sessionsDb.getSessionById(result!);
      // DB custom_name must win over JSONL ai-title AND history.jsonl display.
      assert.equal(session?.custom_name, 'Sidebar custom name');
    });
  } finally {
    restoreHomeDir();
    await rm(tmp, { recursive: true, force: true });
  }
});

test('synchronizeFile does NOT treat "Untitled Claude Session" in DB as a real custom_name', { concurrency: false }, async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'claude-sync-untitled-db-'));
  const workspacePath = path.join(tmp, 'workspace');
  await mkdir(workspacePath, { recursive: true });
  const restoreHomeDir = patchHomeDir(tmp);

  try {
    const claudeHome = path.join(tmp, '.claude');
    await mkdir(claudeHome, { recursive: true });
    await writeFile(path.join(claudeHome, 'history.jsonl'), '', 'utf8');

    // Session JSONL with an ai-title that should win over the DB default.
    await writeSessionJsonl(workspacePath, 'test-session-1.jsonl', [
      JSON.stringify({ type: 'ai-title', aiTitle: 'Real AI title from JSONL', sessionId: 'test-session-1' }),
      JSON.stringify({ type: 'last-prompt', lastPrompt: 'first prompt', sessionId: 'test-session-1' }),
    ]);

    await withIsolatedDatabase(async () => {
      // Seed with the default fallback name — should be ignored.
      sessionsDb.createSession(
        'test-session-1',
        'claude',
        workspacePath,
        'Untitled Claude Session',
      );

      const synchronizer = new ClaudeSessionSynchronizer();
      const result = await synchronizer.synchronizeFile(
        path.join(workspacePath, 'test-session-1.jsonl'),
      );

      assert.ok(result);
      const session = sessionsDb.getSessionById(result!);
      assert.equal(session?.custom_name, 'Real AI title from JSONL');
    });
  } finally {
    restoreHomeDir();
    await rm(tmp, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

test('synchronizeFile skips subagent transcripts', { concurrency: false }, async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'claude-sync-subagent-'));
  const workspacePath = path.join(tmp, 'workspace');
  await mkdir(workspacePath, { recursive: true });
  const restoreHomeDir = patchHomeDir(tmp);

  try {
    const claudeHome = path.join(tmp, '.claude');
    await mkdir(claudeHome, { recursive: true });
    await writeFile(path.join(claudeHome, 'history.jsonl'), '', 'utf8');

    // Create a file whose path contains "subagents".
    const subagentsDir = path.join(workspacePath, 'test-session-1', 'subagents');
    await mkdir(subagentsDir, { recursive: true });
    await writeSessionJsonl(subagentsDir, 'agent-1.jsonl', [
      JSON.stringify({ type: 'ai-title', aiTitle: 'Subagent title', sessionId: 'test-session-1' }),
    ]);

    await withIsolatedDatabase(async () => {
      const synchronizer = new ClaudeSessionSynchronizer();
      const result = await synchronizer.synchronizeFile(
        path.join(subagentsDir, 'agent-1.jsonl'),
      );

      // Subagent transcripts should be silently skipped (return null).
      assert.equal(result, null);
    });
  } finally {
    restoreHomeDir();
    await rm(tmp, { recursive: true, force: true });
  }
});

test('synchronizeFile skips non-jsonl files', { concurrency: false }, async () => {
  await withIsolatedDatabase(async () => {
    const synchronizer = new ClaudeSessionSynchronizer();
    const result = await synchronizer.synchronizeFile('/tmp/not-a-jsonl.txt');
    assert.equal(result, null);
  });
});
