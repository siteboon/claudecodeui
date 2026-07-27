import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import Database from 'better-sqlite3';

import { closeConnection, initializeDatabase, sessionsDb } from '@/modules/database/index.js';
import { CodexSessionSynchronizer } from '@/modules/providers/list/codex/codex-session-synchronizer.provider.js';
import { CodexSessionsProvider } from '@/modules/providers/list/codex/codex-sessions.provider.js';

const patchHomeDir = (nextHomeDir: string) => {
  const original = os.homedir;
  (os as any).homedir = () => nextHomeDir;
  return () => {
    (os as any).homedir = original;
  };
};

async function withIsolatedDatabase(runTest: () => void | Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'codex-provider-db-'));
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
 * Writes one Codex rollout transcript. `firstUserMessage` mirrors the
 * `event_msg`/`user_message` payload the runtime records for the prompt the
 * user typed; omitting it produces a transcript with no user turn.
 */
const writeCodexTranscript = async (
  homeDir: string,
  codexSessionId: string,
  workspacePath: string,
  firstUserMessage?: string,
): Promise<string> => {
  const sessionsDir = path.join(homeDir, '.codex', 'sessions', '2026', '07', '07');
  await mkdir(sessionsDir, { recursive: true });

  const lines: string[] = [
    JSON.stringify({ type: 'session_meta', payload: { id: codexSessionId, cwd: workspacePath } }),
  ];
  if (firstUserMessage !== undefined) {
    lines.push(JSON.stringify({ type: 'event_msg', payload: { type: 'user_message', message: firstUserMessage } }));
  }

  const filePath = path.join(sessionsDir, `rollout-${codexSessionId}.jsonl`);
  await writeFile(filePath, `${lines.join('\n')}\n`, 'utf8');
  return filePath;
};

test('Codex synchronizer titles app-created sessions from the first user message when the indexed title is blank', { concurrency: false }, async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'codex-session-sync-app-'));
  const workspacePath = path.join(tempRoot, 'workspace');
  await mkdir(workspacePath, { recursive: true });
  await mkdir(path.join(tempRoot, '.codex'), { recursive: true });
  await writeFile(
    path.join(tempRoot, '.codex', 'session_index.jsonl'),
    `${JSON.stringify({ id: 'codex-app-1', thread_name: '   ' })}\n`,
    'utf8'
  );
  const restoreHomeDir = patchHomeDir(tempRoot);

  try {
    await writeCodexTranscript(tempRoot, 'codex-app-1', workspacePath, 'Fix the login redirect bug');
    await withIsolatedDatabase(async () => {
      // The app allocates its own id and later maps the provider id onto it,
      // exactly as a message sent from cloudcli does.
      sessionsDb.createAppSession('app-1', 'codex', workspacePath);
      sessionsDb.assignProviderSessionId('app-1', 'codex-app-1');

      const synchronizer = new CodexSessionSynchronizer();
      await synchronizer.synchronize();

      assert.equal(sessionsDb.getSessionById('app-1')?.custom_name, 'Fix the login redirect bug');
    });
  } finally {
    restoreHomeDir();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('Codex synchronizer replaces an app-created fallback with the indexed thread name', { concurrency: false }, async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'codex-session-sync-title-'));
  const workspacePath = path.join(tempRoot, 'workspace');
  await mkdir(workspacePath, { recursive: true });
  await mkdir(path.join(tempRoot, '.codex'), { recursive: true });
  await writeFile(
    path.join(tempRoot, '.codex', 'session_index.jsonl'),
    `${JSON.stringify({ id: 'codex-app-titled', thread_name: '   ' })}\n`,
    'utf8'
  );
  const restoreHomeDir = patchHomeDir(tempRoot);

  try {
    const transcriptPath = await writeCodexTranscript(
      tempRoot,
      'codex-app-titled',
      workspacePath,
      'First prompt fallback',
    );
    await withIsolatedDatabase(async () => {
      sessionsDb.createAppSession('app-titled', 'codex', workspacePath);
      sessionsDb.assignProviderSessionId('app-titled', 'codex-app-titled');

      const synchronizer = new CodexSessionSynchronizer();
      await synchronizer.synchronize();
      assert.equal(sessionsDb.getSessionById('app-titled')?.custom_name, 'First prompt fallback');

      await writeFile(
        path.join(tempRoot, '.codex', 'session_index.jsonl'),
        `${JSON.stringify({ id: 'codex-app-titled', thread_name: 'Old title' })}\n${JSON.stringify({ id: 'codex-app-titled', thread_name: 'Fix login redirect' })}\n`,
        'utf8'
      );
      await synchronizer.synchronizeFile(transcriptPath);

      assert.equal(sessionsDb.getSessionById('app-titled')?.custom_name, 'Fix login redirect');
    });
  } finally {
    restoreHomeDir();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('Codex file synchronization does not persist a stale index title after a newer sync', { concurrency: false }, async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'codex-session-sync-index-race-'));
  const workspacePath = path.join(tempRoot, 'workspace');
  const indexPath = path.join(tempRoot, '.codex', 'session_index.jsonl');
  await mkdir(workspacePath, { recursive: true });
  await mkdir(path.dirname(indexPath), { recursive: true });
  await writeFile(indexPath, '{}\n', 'utf8');
  const restoreHomeDir = patchHomeDir(tempRoot);

  try {
    const transcriptPath = await writeCodexTranscript(
      tempRoot,
      'codex-index-race',
      workspacePath,
      'First prompt fallback',
    );
    await withIsolatedDatabase(async () => {
      let loadCount = 0;
      let markFirstLoadStarted!: () => void;
      let releaseFirstLoad!: () => void;
      const firstLoadStarted = new Promise<void>((resolve) => {
        markFirstLoadStarted = resolve;
      });
      const firstLoadRelease = new Promise<void>((resolve) => {
        releaseFirstLoad = resolve;
      });

      const synchronizer = new CodexSessionSynchronizer();
      (synchronizer as any).loadIndexedNameMap = async () => {
        loadCount += 1;
        if (loadCount === 1) {
          markFirstLoadStarted();
          await firstLoadRelease;
          return new Map([['codex-index-race', 'Old indexed title']]);
        }
        return new Map([['codex-index-race', 'New indexed title']]);
      };

      const firstSync = synchronizer.synchronizeFile(transcriptPath);
      await firstLoadStarted;

      await writeFile(indexPath, '{"updated":true}\n', 'utf8');
      const nextMtime = new Date(Date.now() + 60_000);
      await utimes(indexPath, nextMtime, nextMtime);
      const secondSync = synchronizer.synchronizeFile(transcriptPath);

      releaseFirstLoad();
      await Promise.all([firstSync, secondSync]);

      assert.equal(loadCount, 2);
      assert.equal(
        sessionsDb.getSessionById('codex-index-race')?.custom_name,
        'New indexed title',
      );
    });
  } finally {
    restoreHomeDir();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('Codex full synchronization serializes with a watcher update', { concurrency: false }, async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'codex-session-sync-full-race-'));
  const workspacePath = path.join(tempRoot, 'workspace');
  const indexPath = path.join(tempRoot, '.codex', 'session_index.jsonl');
  await mkdir(workspacePath, { recursive: true });
  await mkdir(path.dirname(indexPath), { recursive: true });
  await writeFile(
    indexPath,
    `${JSON.stringify({ id: 'codex-full-race', thread_name: 'Old indexed title' })}\n`,
    'utf8',
  );
  const restoreHomeDir = patchHomeDir(tempRoot);

  try {
    const transcriptPath = await writeCodexTranscript(
      tempRoot,
      'codex-full-race',
      workspacePath,
      'First prompt fallback',
    );
    await withIsolatedDatabase(async () => {
      let markOldSessionParsed!: () => void;
      let releaseFullSync!: () => void;
      const oldSessionParsed = new Promise<void>((resolve) => {
        markOldSessionParsed = resolve;
      });
      const fullSyncRelease = new Promise<void>((resolve) => {
        releaseFullSync = resolve;
      });

      const synchronizer = new CodexSessionSynchronizer();
      const originalProcessSessionFile = (synchronizer as any).processSessionFile;
      (synchronizer as any).processSessionFile = async (filePath: string, nameMap: Map<string, string>) => {
        const parsed = await originalProcessSessionFile.call(synchronizer, filePath, nameMap);
        if (nameMap.get('codex-full-race') === 'Old indexed title') {
          markOldSessionParsed();
          await fullSyncRelease;
        }
        return parsed;
      };

      const fullSync = synchronizer.synchronize();
      await oldSessionParsed;

      await writeFile(
        indexPath,
        `${JSON.stringify({ id: 'codex-full-race', thread_name: 'New indexed title' })}\n`,
        'utf8',
      );
      const nextMtime = new Date(Date.now() + 60_000);
      await utimes(indexPath, nextMtime, nextMtime);

      const watcherSync = synchronizer.synchronizeFile(transcriptPath);
      releaseFullSync();
      await Promise.all([fullSync, watcherSync]);
      assert.equal(
        sessionsDb.getSessionById('codex-full-race')?.custom_name,
        'New indexed title',
      );
    });
  } finally {
    restoreHomeDir();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('Codex synchronizer preserves a CloudCLI manual name over a Codex title', { concurrency: false }, async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'codex-session-sync-manual-title-'));
  const workspacePath = path.join(tempRoot, 'workspace');
  await mkdir(workspacePath, { recursive: true });
  await mkdir(path.join(tempRoot, '.codex'), { recursive: true });
  await writeFile(
    path.join(tempRoot, '.codex', 'session_index.jsonl'),
    `${JSON.stringify({ id: 'codex-manual-title', thread_name: 'Codex title' })}\n`,
    'utf8'
  );
  const restoreHomeDir = patchHomeDir(tempRoot);

  try {
    await writeCodexTranscript(tempRoot, 'codex-manual-title', workspacePath, 'First prompt fallback');
    await withIsolatedDatabase(async () => {
      sessionsDb.createAppSession('app-manual-title', 'codex', workspacePath);
      sessionsDb.assignProviderSessionId('app-manual-title', 'codex-manual-title');
      sessionsDb.updateSessionCustomName('app-manual-title', 'My CloudCLI name');

      await new CodexSessionSynchronizer().synchronize();

      assert.equal(sessionsDb.getSessionById('app-manual-title')?.custom_name, 'My CloudCLI name');
    });
  } finally {
    restoreHomeDir();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('Codex synchronizer replaces a fallback with the Codex state database title', { concurrency: false }, async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'codex-session-sync-state-title-'));
  const workspacePath = path.join(tempRoot, 'workspace');
  await mkdir(workspacePath, { recursive: true });
  const restoreHomeDir = patchHomeDir(tempRoot);

  try {
    await writeCodexTranscript(tempRoot, 'codex-state-titled', workspacePath, 'First prompt fallback');
    await withIsolatedDatabase(async () => {
      const synchronizer = new CodexSessionSynchronizer();
      await synchronizer.synchronize();
      assert.equal(sessionsDb.getSessionById('codex-state-titled')?.custom_name, 'Untitled Codex Session');
      sessionsDb.updateSessionIsArchived('codex-state-titled', true);

      const stateDb = new Database(path.join(tempRoot, '.codex', 'state_5.sqlite'));
      stateDb.exec('CREATE TABLE threads (id TEXT PRIMARY KEY, title TEXT NOT NULL)');
      stateDb.prepare('INSERT INTO threads (id, title) VALUES (?, ?)')
        .run('codex-state-titled', 'Fix login redirect');
      stateDb.close();

      await synchronizer.synchronize(
        new Date(Date.now() + 60_000),
        { initializing: true },
      );
      assert.equal(sessionsDb.getSessionById('codex-state-titled')?.custom_name, 'Fix login redirect');
      assert.equal(sessionsDb.getSessionById('codex-state-titled')?.isArchived, 1);
    });
  } finally {
    restoreHomeDir();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('Codex file synchronization does not reload the full state title database', { concurrency: false }, async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'codex-session-file-sync-state-title-'));
  const workspacePath = path.join(tempRoot, 'workspace');
  await mkdir(workspacePath, { recursive: true });
  const restoreHomeDir = patchHomeDir(tempRoot);

  try {
    const transcriptPath = await writeCodexTranscript(
      tempRoot,
      'codex-state-file-sync',
      workspacePath,
      'First prompt fallback',
    );
    await withIsolatedDatabase(async () => {
      const stateDb = new Database(path.join(tempRoot, '.codex', 'state_5.sqlite'));
      stateDb.exec('CREATE TABLE threads (id TEXT PRIMARY KEY, title TEXT NOT NULL)');
      stateDb.prepare('INSERT INTO threads (id, title) VALUES (?, ?)')
        .run('codex-state-file-sync', 'Initial state title');

      const synchronizer = new CodexSessionSynchronizer();
      await synchronizer.synchronize(undefined, { initializing: true });
      assert.equal(
        sessionsDb.getSessionById('codex-state-file-sync')?.custom_name,
        'Initial state title',
      );

      stateDb.prepare('UPDATE threads SET title = ? WHERE id = ?')
        .run('Changed state title', 'codex-state-file-sync');
      stateDb.close();

      await synchronizer.synchronizeFile(transcriptPath);

      assert.equal(
        sessionsDb.getSessionById('codex-state-file-sync')?.custom_name,
        'Initial state title',
      );
    });
  } finally {
    restoreHomeDir();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('Codex full synchronization does not reload state titles after initialization', { concurrency: false }, async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'codex-session-full-sync-state-title-'));
  const workspacePath = path.join(tempRoot, 'workspace');
  await mkdir(workspacePath, { recursive: true });
  const restoreHomeDir = patchHomeDir(tempRoot);

  try {
    await writeCodexTranscript(
      tempRoot,
      'codex-state-full-sync',
      workspacePath,
      'First prompt fallback',
    );
    await withIsolatedDatabase(async () => {
      const stateDb = new Database(path.join(tempRoot, '.codex', 'state_5.sqlite'));
      stateDb.exec('CREATE TABLE threads (id TEXT PRIMARY KEY, title TEXT NOT NULL)');
      stateDb.prepare('INSERT INTO threads (id, title) VALUES (?, ?)')
        .run('codex-state-full-sync', 'Initial state title');

      const synchronizer = new CodexSessionSynchronizer();
      await synchronizer.synchronize(undefined, { initializing: true });
      assert.equal(
        sessionsDb.getSessionById('codex-state-full-sync')?.custom_name,
        'Initial state title',
      );

      stateDb.prepare('UPDATE threads SET title = ? WHERE id = ?')
        .run('Changed state title', 'codex-state-full-sync');
      stateDb.close();

      await synchronizer.synchronize();

      assert.equal(
        sessionsDb.getSessionById('codex-state-full-sync')?.custom_name,
        'Initial state title',
      );
    });
  } finally {
    restoreHomeDir();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('Codex synchronizer skips sub-agent rollout files', { concurrency: false }, async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'codex-session-sync-subagent-'));
  const workspacePath = path.join(tempRoot, 'workspace');
  await mkdir(workspacePath, { recursive: true });
  const restoreHomeDir = patchHomeDir(tempRoot);

  try {
    // Codex >=0.144 spawn_agent threads write their own rollout files into the
    // same sessions tree, marked via thread_source/source in session_meta.
    const sessionsDir = path.join(tempRoot, '.codex', 'sessions', '2026', '07', '07');
    await mkdir(sessionsDir, { recursive: true });
    await writeFile(
      path.join(sessionsDir, 'rollout-codex-subagent-1.jsonl'),
      `${JSON.stringify({
        type: 'session_meta',
        payload: {
          id: 'codex-subagent-1',
          cwd: workspacePath,
          thread_source: 'subagent',
          parent_thread_id: 'codex-parent-1',
          source: { subagent: { thread_spawn: { parent_thread_id: 'codex-parent-1', depth: 1 } } },
        },
      })}\n`,
      'utf8'
    );
    await writeCodexTranscript(tempRoot, 'codex-parent-1', workspacePath);

    await withIsolatedDatabase(async () => {
      const synchronizer = new CodexSessionSynchronizer();
      const processed = await synchronizer.synchronize();

      assert.equal(processed, 1);
      assert.ok(sessionsDb.getSessionById('codex-parent-1'));
      assert.equal(sessionsDb.getSessionById('codex-subagent-1'), null);
    });
  } finally {
    restoreHomeDir();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('Codex synchronizer leaves indexed sessions untitled when no name is available', { concurrency: false }, async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'codex-session-sync-indexed-'));
  const workspacePath = path.join(tempRoot, 'workspace');
  await mkdir(workspacePath, { recursive: true });
  const restoreHomeDir = patchHomeDir(tempRoot);

  try {
    // A CLI-created session has no app row; its first user message must NOT be
    // used as the title, preserving the existing indexing behavior.
    await writeCodexTranscript(tempRoot, 'codex-indexed-1', workspacePath, 'This prompt should be ignored');
    await withIsolatedDatabase(async () => {
      const synchronizer = new CodexSessionSynchronizer();
      await synchronizer.synchronize();

      assert.equal(sessionsDb.getSessionById('codex-indexed-1')?.custom_name, 'Untitled Codex Session');
    });
  } finally {
    restoreHomeDir();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('Codex history renders Promise.all shell wrappers as Bash activity', { concurrency: false }, async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'codex-exec-history-'));
  const workspacePath = path.join(tempRoot, 'workspace');
  await mkdir(workspacePath, { recursive: true });
  const restoreHomeDir = patchHomeDir(tempRoot);

  try {
    const providerSessionId = 'codex-exec-1';
    const transcriptPath = await writeCodexTranscript(tempRoot, providerSessionId, workspacePath);
    const execInput = 'const cmds = ["echo one", "echo two"]; await Promise.all(cmds.map(command => tools.shell_command({ command })));';
    const planInput = 'await tools.update_plan({ plan: [] });';
    await writeFile(transcriptPath, [
      JSON.stringify({ type: 'session_meta', payload: { id: providerSessionId, cwd: workspacePath } }),
      JSON.stringify({ type: 'response_item', payload: { type: 'custom_tool_call', name: 'exec', call_id: 'exec-1', input: execInput } }),
      JSON.stringify({ type: 'response_item', payload: { type: 'custom_tool_call_output', call_id: 'exec-1', output: 'done' } }),
      JSON.stringify({ type: 'response_item', payload: { type: 'custom_tool_call', name: 'exec', call_id: 'plan-1', input: planInput } }),
      JSON.stringify({ type: 'response_item', payload: { type: 'custom_tool_call_output', call_id: 'plan-1', output: 'done' } }),
    ].join('\n') + '\n', 'utf8');

    await withIsolatedDatabase(async () => {
      sessionsDb.createAppSession('app-exec-1', 'codex', workspacePath);
      sessionsDb.assignProviderSessionId('app-exec-1', providerSessionId);
      await new CodexSessionSynchronizer().synchronize();

      const history = await new CodexSessionsProvider().fetchHistory('app-exec-1');
      const toolUses = history.messages.filter((message) => message.kind === 'tool_use');
      const toolResults = history.messages.filter((message) => message.kind === 'tool_result');

      assert.equal(toolUses.length, 1);
      assert.equal(toolUses[0].toolName, 'Bash');
      assert.equal(toolUses[0].toolInput, JSON.stringify({ command: 'echo one\necho two' }));
      assert.equal(toolResults.some((message) => message.toolCallId === 'plan-1'), false);
    });
  } finally {
    restoreHomeDir();
    await rm(tempRoot, { recursive: true, force: true });
  }
});
