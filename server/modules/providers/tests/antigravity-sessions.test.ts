import assert from 'node:assert/strict';
import { appendFile, mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import fsp from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import path from 'node:path';
import test from 'node:test';

import Database from 'better-sqlite3';

import { closeConnection, initializeDatabase, sessionsDb } from '@/modules/database/index.js';
import { AntigravitySessionSynchronizer } from '@/modules/providers/list/antigravity/antigravity-session-synchronizer.provider.js';
import { CursorSessionSynchronizer } from '@/modules/providers/list/cursor/cursor-session-synchronizer.provider.js';
import { AntigravitySessionsProvider } from '@/modules/providers/list/antigravity/antigravity-sessions.provider.js';
import { sessionsService } from '@/modules/providers/services/sessions.service.js';
import { antigravityRunBindings } from '@/modules/providers/services/antigravity-run-bindings.service.js';
import { appendFilesInputTag, appendImagesInputTag } from '@/shared/index.js';

const patchHomeDir = (nextHomeDir: string) => {
  const original = os.homedir;
  (os as any).homedir = () => nextHomeDir;
  return () => {
    (os as any).homedir = original;
  };
};

test('AGY history restores attachment cards, native anchors, thinking and paired tool results', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agy-history-parity-'));
  try {
    const transcript = path.join(root, 'transcript.jsonl');
    await writeFile(transcript, [
      { step_index: 0, source: 'USER_EXPLICIT', type: 'USER_INPUT', content: appendFilesInputTag(appendImagesInputTag('Review',
        [{ path: '/assets/screen.png', name: '화면.png' }]), [{ path: '/assets/spec.txt', name: '요구사항.txt' }]) },
      { step_index: 1, source: 'MODEL', type: 'PLANNER_RESPONSE', thinking: 'reasoning', content: 'answer', tool_calls: [{ name: 'read_file', args: { path: 'spec.txt' } }] },
      { step_index: 2, source: 'MODEL', type: 'GENERIC', content: 'tool output' },
    ].map((row) => JSON.stringify(row)).join('\n'));
    const history = await new AntigravitySessionsProvider().fetchHistory('app', { jsonlPath: transcript });
    assert.equal(history.messages[0].content, 'Review');
    assert.equal(history.messages[0].transcriptAnchorId, '0');
    assert.deepEqual(history.messages[0].images, [{ path: '/assets/screen.png', name: '화면.png' }]);
    assert.deepEqual(history.messages[0].files, [{ path: '/assets/spec.txt', name: '요구사항.txt' }]);
    assert.deepEqual(history.messages.slice(1).map((message) => message.kind), ['thinking', 'text', 'tool_use', 'tool_result']);
    assert.equal(history.messages[3].toolId, history.messages[4].toolId);
    assert.equal(history.messages[3].id, 'app-2-call', 'tool cards use the same result-step identity as live events');
    assert.equal(history.messages[4].id, 'app-2');
    assert.equal(history.messages[3].toolName, 'read_file');
  } finally { await rm(root, { recursive: true, force: true }); }
});

async function withIsolatedDatabase(runTest: () => void | Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'antigravity-provider-db-'));
  const databasePath = path.join(tempDirectory, 'auth.db');

  closeConnection();
  try {
    process.env.DATABASE_PATH = databasePath;
    await initializeDatabase();
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

const writeAntigravityTranscript = async (
  homeDir: string,
  sessionId: string,
  userMessage = 'Fix Antigravity history',
  assistantMessage = 'History is visible now.',
): Promise<string> => {
  const logsDir = path.join(
    homeDir,
    '.gemini',
    'antigravity-cli',
    'brain',
    sessionId,
    '.system_generated',
    'logs',
  );
  await mkdir(logsDir, { recursive: true });

  const transcriptPath = path.join(logsDir, 'transcript.jsonl');
  const lines = [
    {
      step_index: 0,
      source: 'USER_EXPLICIT',
      type: 'USER_INPUT',
      created_at: '2026-07-17T05:37:32Z',
      content: `<USER_REQUEST>\n${userMessage}\n</USER_REQUEST>\n<ADDITIONAL_METADATA>\nignored\n</ADDITIONAL_METADATA>`,
    },
    {
      step_index: 1,
      source: 'MODEL',
      type: 'PLANNER_RESPONSE',
      created_at: '2026-07-17T05:37:33Z',
      content: assistantMessage,
    },
  ];
  await writeFile(transcriptPath, `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`, 'utf8');
  return transcriptPath;
};

function encodeWireField(field: number, value: Buffer): Buffer {
  const encodeVarint = (number: number): number[] => {
    const bytes: number[] = [];
    do {
      const byte = number % 128;
      number = Math.floor(number / 128);
      bytes.push(number ? byte | 0x80 : byte);
    } while (number);
    return bytes;
  };
  return Buffer.concat([Buffer.from(encodeVarint(field * 8 + 2)), Buffer.from(encodeVarint(value.length)), value]);
}

test('Antigravity synchronizer indexes transcript rows from history metadata', { concurrency: false }, async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'antigravity-session-sync-'));
  const workspacePath = path.join(tempRoot, 'workspace');
  const sessionId = 'agy-session-1';
  const restoreHomeDir = patchHomeDir(tempRoot);

  try {
    await mkdir(workspacePath, { recursive: true });
    const transcriptPath = await writeAntigravityTranscript(tempRoot, sessionId);
    const historyPath = path.join(tempRoot, '.gemini', 'antigravity-cli', 'history.jsonl');
    await writeFile(
      historyPath,
      `${JSON.stringify({
        display: 'Fix Antigravity history',
        timestamp: 1784266652000,
        workspace: workspacePath,
        conversationId: sessionId,
      })}\n`,
      'utf8',
    );

    await withIsolatedDatabase(async () => {
      const synchronizer = new AntigravitySessionSynchronizer();
      await synchronizer.synchronize();

      const session = sessionsDb.getSessionById(sessionId);
      assert.equal(session?.provider, 'antigravity');
      assert.equal(session?.provider_session_id, sessionId);
      assert.equal(session?.project_path, workspacePath);
      assert.equal(session?.jsonl_path, transcriptPath);
      assert.equal(session?.custom_name, 'Fix Antigravity history');
    });
  } finally {
    restoreHomeDir();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('Antigravity history reader normalizes transcript messages', { concurrency: false }, async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'antigravity-history-'));
  const restore = patchHomeDir(tempRoot);
  try {
    const transcriptPath = await writeAntigravityTranscript(tempRoot, 'agy-session-2');
    const provider = new AntigravitySessionsProvider();

    const history = await provider.fetchHistory('app-session-2', {
      providerSessionId: 'agy-session-2',
      jsonlPath: transcriptPath,
    });

    assert.equal(history.total, 2);
    assert.equal(history.messages[0]?.kind, 'text');
    assert.equal(history.messages[0]?.role, 'user');
    assert.equal(history.messages[0]?.content, 'Fix Antigravity history');
    assert.equal(history.messages[1]?.kind, 'text');
    assert.equal(history.messages[1]?.role, 'assistant');
    assert.equal(history.messages[1]?.content, 'History is visible now.');
  } finally {
    restore();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('Antigravity history reader resolves the native transcript when the indexed path is missing', { concurrency: false }, async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'antigravity-history-fallback-'));
  const restoreHomeDir = patchHomeDir(tempRoot);
  try {
    await writeAntigravityTranscript(tempRoot, 'agy-session-fallback');
    const provider = new AntigravitySessionsProvider();

    const history = await provider.fetchHistory('app-session-fallback', {
      providerSessionId: 'agy-session-fallback',
      jsonlPath: null,
    });

    assert.equal(history.total, 2);
    assert.equal(history.messages[0]?.content, 'Fix Antigravity history');
    assert.equal(history.messages[1]?.content, 'History is visible now.');
  } finally {
    restoreHomeDir();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('Antigravity history reader skips a partially written JSONL line', { concurrency: false }, async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'antigravity-partial-history-'));
  const restore = patchHomeDir(tempRoot);
  try {
    const transcriptPath = await writeAntigravityTranscript(tempRoot, 'agy-session-partial');
    await appendFile(transcriptPath, '{"step_index":2,"source":"MODEL"', 'utf8');
    const provider = new AntigravitySessionsProvider();

    const history = await provider.fetchHistory('app-session-partial', {
      providerSessionId: 'agy-session-partial',
      jsonlPath: transcriptPath,
      offset: 1,
      limit: 1,
    });

    assert.equal(history.total, 2);
    assert.equal(history.messages.length, 1);
    assert.equal(history.messages[0]?.content, 'Fix Antigravity history');
    assert.equal(history.offset, 1);
    assert.equal(history.limit, 1);
  } finally {
    restore();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('Antigravity history restores clipped assistant text and hides the wait control marker', { concurrency: false }, async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'antigravity-native-history-'));
  const restoreHomeDir = patchHomeDir(tempRoot);
  const providerSessionId = 'agy-session-native';
  try {
    const transcriptPath = await writeAntigravityTranscript(tempRoot, providerSessionId);
    const fullContent = 'Intro\n```python\nprint("hello")\n```\nOutro';
    await appendFile(transcriptPath, [
      JSON.stringify({
        step_index: 2,
        source: 'MODEL',
        type: 'PLANNER_RESPONSE',
        content: 'Intro\n```python\n<truncated 22 bytes>\nOutro',
        truncated_fields: ['content'],
      }),
      JSON.stringify({
        step_index: 3,
        source: 'MODEL',
        type: 'PLANNER_RESPONSE',
        content: '<WAITING_FOR_EVENTS>\n</WAITING_FOR_EVENTS>',
      }),
    ].join('\n') + '\n');

    const conversationsDir = path.join(tempRoot, '.gemini', 'antigravity-cli', 'conversations');
    await mkdir(conversationsDir, { recursive: true });
    const db = new Database(path.join(conversationsDir, `${providerSessionId}.db`));
    try {
      db.exec('CREATE TABLE steps (idx INTEGER PRIMARY KEY, step_type INTEGER, step_payload BLOB)');
      db.prepare('INSERT INTO steps (idx, step_type, step_payload) VALUES (?, ?, ?)').run(
        2,
        15,
        encodeWireField(20, encodeWireField(1, Buffer.from(fullContent))),
      );
      db.prepare('INSERT INTO steps (idx, step_type, step_payload) VALUES (?, ?, ?)').run(
        4,
        17,
        encodeWireField(24, encodeWireField(3, encodeWireField(1, Buffer.from('Individual quota reached.')))),
      );
    } finally {
      db.close();
    }

    const history = await new AntigravitySessionsProvider().fetchHistory('app-session-native', {
      providerSessionId,
      jsonlPath: transcriptPath,
    });
    assert.equal(history.total, 4);
    assert.equal(history.messages[2]?.content, fullContent);
    assert.equal(history.messages.some((message) => message.content?.includes('WAITING_FOR_EVENTS')), false);
    assert.equal(history.messages[3]?.kind, 'error');
    assert.equal(history.messages[3]?.content, 'Individual quota reached.');

    const mismatchedDb = new Database(path.join(conversationsDir, `${providerSessionId}.db`));
    try {
      mismatchedDb.prepare('UPDATE steps SET step_payload = ? WHERE idx = 2').run(
        encodeWireField(20, encodeWireField(1, Buffer.from('A different response'))),
      );
    } finally {
      mismatchedDb.close();
    }
    const fallback = await new AntigravitySessionsProvider().fetchHistory('app-session-native', {
      providerSessionId,
      jsonlPath: transcriptPath,
    });
    assert.match(fallback.messages[2]?.content ?? '', /<truncated 22 bytes>/);
  } finally {
    restoreHomeDir();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('history sync skips malformed lines, decodes file URLs and keeps workspace roots over tool paths', { concurrency: false }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agy-history-metadata-'));
  const restore = patchHomeDir(root);
  try {
    const workspace = path.join(root, 'workspace with spaces');
    const first = await writeAntigravityTranscript(root, 'history-a');
    const second = await writeAntigravityTranscript(root, 'history-b');
    await appendFile(first, '\n' + JSON.stringify({ type: 'VIEW_FILE', content: 'File Path: `file:///incorrect/root/src/file.ts`' }));
    const { pathToFileURL } = await import('node:url');
    await writeFile(path.join(root, '.gemini', 'antigravity-cli', 'history.jsonl'), [
      JSON.stringify({ conversationId: 'history-a', workspace: pathToFileURL(workspace).href, display: 'First title' }),
      '{malformed record',
      JSON.stringify({ conversationId: 'history-b', workspace: 'file:///C:/Users/Test/My%20Project', display: 'Windows title' }),
      '{"conversationId":',
    ].join('\n'));
    await withIsolatedDatabase(async () => {
      const sync = new AntigravitySessionSynchronizer();
      assert.equal(await sync.synchronize(), 2);
      assert.equal(sessionsDb.getSessionById('history-a')?.project_path, workspace);
      assert.equal(sessionsDb.getSessionById('history-a')?.custom_name, 'First title');
      assert.equal(sessionsDb.getSessionById('history-b')?.project_path, 'C:\\Users\\Test\\My Project');
      assert.equal(sessionsDb.getSessionById('history-b')?.jsonl_path, second);
    });
  } finally { restore(); await rm(root, { recursive: true, force: true }); }
});

test('sync never infers a workspace from VIEW_FILE or LIST_DIRECTORY tool targets', { concurrency: false }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agy-no-guessed-root-'));
  const restore = patchHomeDir(root);
  try {
    const transcript = await writeAntigravityTranscript(root, 'unmapped');
    await appendFile(transcript, '\n' + [
      { type: 'VIEW_FILE', content: 'File Path: `file:///workspace/src/subfolder/file.ts`' },
      { type: 'LIST_DIRECTORY', content: 'File Path: `file:///workspace/src/subfolder`' },
    ].map((entry) => JSON.stringify(entry)).join('\n'));
    await withIsolatedDatabase(async () => {
      assert.equal(await new AntigravitySessionSynchronizer().synchronizeFile(transcript), null);
      assert.equal(sessionsDb.getAllSessions().length, 0);
    });
  } finally { restore(); await rm(root, { recursive: true, force: true }); }
});

test('watcher defers unmapped transcripts then reuses the exact app row without sidebar duplicates', { concurrency: false }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agy-pending-sidebar-'));
  const restore = patchHomeDir(root);
  try {
    const sync = new AntigravitySessionSynchronizer();
    await sync.synchronize();
    const workspace = path.join(root, 'workspace');
    const own = await writeAntigravityTranscript(root, 'own-native', 'same prompt');
    const foreign = await writeAntigravityTranscript(root, 'terminal-native', 'same prompt');
    await writeFile(path.join(root, '.gemini', 'antigravity-cli', 'history.jsonl'),
      ['own-native', 'terminal-native'].map((id) => JSON.stringify({ conversationId: id, workspace, display: 'same prompt' })).join('\n'));
    await withIsolatedDatabase(async () => {
      sessionsDb.createAppSession('app-session', 'antigravity', workspace, 'same prompt');
      const releasePendingBinding = antigravityRunBindings.trackPendingRun(workspace);
      assert.equal(await sync.synchronizeFile(own), null);
      assert.equal(await sync.synchronizeFile(foreign), null);
      assert.equal(sessionsDb.getAllSessions().length, 1);
      assert.equal(sessionsDb.getSessionById('app-session')?.provider_session_id, null);
      // Mirrors the runtime init event's exact mapping, instead of choosing a recent file.
      sessionsDb.assignProviderSessionId('app-session', 'own-native');
      releasePendingBinding();
      assert.equal(await sync.synchronize(new Date(Date.now() + 10000)), 2, 'incremental scans must retry deferred files');
      assert.equal(sessionsDb.getAllSessions().length, 2);
      assert.equal(sessionsDb.getSessionByProviderSessionId('own-native')?.session_id, 'app-session');
      assert.equal(sessionsDb.getSessionByProviderSessionId('terminal-native')?.session_id, 'terminal-native');
      assert.equal(sessionsDb.getSessionById('app-session')?.jsonl_path, own);
    });
  } finally { restore(); await rm(root, { recursive: true, force: true }); }
});

test('mapped app workspace allows transcript indexing before history is written', { concurrency: false }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agy-init-before-history-'));
  const restore = patchHomeDir(root);
  try {
    const workspace = path.join(root, 'workspace');
    const transcript = await writeAntigravityTranscript(root, 'early-native');
    await withIsolatedDatabase(async () => {
      sessionsDb.createAppSession('early-app', 'antigravity', workspace, 'Existing title');
      sessionsDb.assignProviderSessionId('early-app', 'early-native');
      assert.equal(await new AntigravitySessionSynchronizer().synchronizeFile(transcript), 'early-app');
      assert.equal(sessionsDb.getAllSessions().length, 1);
      assert.equal(sessionsDb.getSessionById('early-app')?.custom_name, 'Existing title');
    });
  } finally { restore(); await rm(root, { recursive: true, force: true }); }
});

test('an abandoned pending app row does not suppress unrelated terminal sessions', { concurrency: false }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agy-abandoned-pending-'));
  const restore = patchHomeDir(root);
  try {
    const workspace = path.join(root, 'workspace');
    const transcript = await writeAntigravityTranscript(root, 'external-native');
    await writeFile(path.join(root, '.gemini', 'antigravity-cli', 'history.jsonl'),
      JSON.stringify({ conversationId: 'external-native', workspace, display: 'External session' }));
    await withIsolatedDatabase(async () => {
      sessionsDb.createAppSession('abandoned-app', 'antigravity', workspace, 'Unsent prompt');
      assert.equal(await new AntigravitySessionSynchronizer().synchronizeFile(transcript), 'external-native');
      assert.equal(sessionsDb.getSessionById('abandoned-app')?.provider_session_id, null);
      assert.equal(sessionsDb.getAllSessions().length, 2);
    });
  } finally { restore(); await rm(root, { recursive: true, force: true }); }
});


test('incremental AGY scans refresh resumed transcripts and retain the mapped app workspace', async () => {
  await withIsolatedDatabase(async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), 'antigravity-recency-'));
    const restoreHome = patchHomeDir(home);
    try {
      const id = 'native-resumed';
      const transcript = await writeAntigravityTranscript(home, id);
      sessionsDb.createAppSession('mapped-resumed', 'antigravity', '/mapped-workspace', 'Keep title');
      sessionsDb.assignProviderSessionId('mapped-resumed', id);
      await writeFile(path.join(home, '.gemini', 'antigravity-cli', 'history.jsonl'), JSON.stringify({
        conversationId: id, workspace: '/stale-native-workspace', display: 'Native title',
      }) + '\n');
      const synchronizer = new AntigravitySessionSynchronizer();
      assert.equal(await synchronizer.synchronize(), 1);
      const since = new Date(Date.now() + 1000);
      const updated = new Date(since.getTime() + 1000);
      await appendFile(transcript, JSON.stringify({
        step_index: 2, source: 'USER_EXPLICIT', type: 'USER_INPUT', content: 'continue',
      }) + '\n');
      await utimes(transcript, updated, updated);
      assert.equal(await synchronizer.synchronize(since), 1);
      const session = sessionsDb.getSessionById('mapped-resumed');
      assert.equal(session?.project_path, '/mapped-workspace');
      assert.equal(session?.custom_name, 'Keep title');
      assert.equal(session?.updated_at, updated.toISOString());
    } finally { restoreHome(); await rm(home, { recursive: true, force: true }); }
  });
});

test('live AGY chunks preserve whitespace and deferred history retries without another transcript write', async () => {
  const provider = new AntigravitySessionsProvider();
  assert.equal(['hello', ' ', 'world', '\n'].flatMap((chunk) => provider.normalizeMessage(chunk, 'a')).map((message) => message.content).join(''), 'hello world\n');
  assert.equal(provider.normalizeMessage({ content: '  ' }, 'a')[0]?.content, '  ');
  const root = await mkdtemp(path.join(os.tmpdir(), 'agy-deferred-metadata-'));
  const restore = patchHomeDir(root);
  try {
    await writeAntigravityTranscript(root, 'deferred');
    await withIsolatedDatabase(async () => {
      const synchronizer = new AntigravitySessionSynchronizer();
      assert.equal(await synchronizer.synchronize(), 0);
      await writeFile(path.join(root, '.gemini', 'antigravity-cli', 'history.jsonl'), JSON.stringify({ conversationId: 'deferred', workspace: root }) + '\n');
      assert.equal(await synchronizer.synchronize(new Date(Date.now() + 10000)), 1);
      assert.equal(sessionsDb.getSessionById('deferred')?.project_path, root);
    });
  } finally { restore(); await rm(root, { recursive: true, force: true }); }
});


test('deferred old transcript survives an indexing failure', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agy-deferred-failure-'));
  const restore = patchHomeDir(root);
  try {
    await writeAntigravityTranscript(root, 'deferred-failure');
    await withIsolatedDatabase(async () => {
      const sync = new AntigravitySessionSynchronizer();
      assert.equal(await sync.synchronize(), 0);
      await writeFile(path.join(root, '.gemini', 'antigravity-cli', 'history.jsonl'), JSON.stringify({ conversationId: 'deferred-failure', workspace: root }));
      const original = sessionsDb.createSession;
      sessionsDb.createSession = () => { throw new Error('injected database failure'); };
      try { await assert.rejects(sync.synchronize(new Date(Date.now() + 10000)), /injected/); }
      finally { sessionsDb.createSession = original; }
      assert.equal(await sync.synchronize(new Date(Date.now() + 10000)), 1);
      assert.equal(sessionsDb.getSessionById('deferred-failure')?.project_path, root);
    });
  } finally { restore(); await rm(root, { recursive: true, force: true }); }
});


test('startup scan recovers deferred transcripts older than the persisted cursor', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agy-deferred-restart-'));
  const restore = patchHomeDir(root);
  try {
    const transcript = await writeAntigravityTranscript(root, 'restart');
    await utimes(transcript, new Date('2020-01-01'), new Date('2020-01-01'));
    await withIsolatedDatabase(async () => {
      assert.equal(await new AntigravitySessionSynchronizer().synchronize(), 0);
      await writeFile(path.join(root, '.gemini', 'antigravity-cli', 'history.jsonl'), JSON.stringify({ conversationId: 'restart', workspace: root }));
      const restarted = new AntigravitySessionSynchronizer();
      assert.equal(await restarted.synchronize(new Date()), 1);
      assert.equal(sessionsDb.getSessionById('restart')?.project_path, root);
      assert.equal(await restarted.synchronize(new Date(Date.now() + 10000)), 0, 'later scans retain the incremental cursor');
    });
  } finally { restore(); await rm(root, { recursive: true, force: true }); }
});

test('Cursor single-file and batch rescans preserve an external session rename', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cursor-rename-sync-'));
  const restore = patchHomeDir(root);
  try {
    const project = path.join(root, '.cursor', 'projects', 'example');
    const directory = path.join(project, 'agent-transcripts', 'renamed');
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(project, 'worker.log'), 'workspacePath=' + root);
    const transcript = path.join(directory, 'renamed.jsonl');
    await writeFile(transcript, JSON.stringify({ role: 'user', message: { content: [{ text: 'debug build' }] } }));
    await withIsolatedDatabase(async () => {
      const sync = new CursorSessionSynchronizer();
      await sync.synchronizeFile(transcript);
      assert.equal(sessionsDb.getSessionById('renamed')?.custom_name, 'debug build');
      sessionsDb.updateSessionCustomName('renamed', 'Release checklist');
      await sync.synchronizeFile(transcript);
      assert.equal(sessionsDb.getSessionById('renamed')?.custom_name, 'Release checklist');
      await sync.synchronize();
      assert.equal(sessionsDb.getSessionById('renamed')?.custom_name, 'Release checklist');
    });
  } finally { restore(); await rm(root, { recursive: true, force: true }); }
});

test('transient transcript read failures retry past the cursor and missing deferred files are forgotten', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agy-transient-read-'));
  const restore = patchHomeDir(root);
  try {
    const transcript = await writeAntigravityTranscript(root, 'transient');
    await writeFile(path.join(root, '.gemini', 'antigravity-cli', 'history.jsonl'), JSON.stringify({ conversationId: 'transient', workspace: root }));
    await withIsolatedDatabase(async () => {
      await rm(transcript); await mkdir(transcript);
      const sync = new AntigravitySessionSynchronizer();
      assert.equal(await sync.synchronize(), 0);
      // A directory is excluded by batch discovery; a watcher notification
      // supplies the candidate and exercises the actual EISDIR read failure.
      assert.equal(await sync.synchronizeFile(transcript), null);
      await rm(transcript, { recursive: true });
      await writeFile(transcript, JSON.stringify({ source: 'USER_EXPLICIT', type: 'USER_INPUT', content: 'retry' }) + '\n');
      assert.equal(await sync.synchronize(new Date(Date.now() + 10000)), 1);
      await rm(transcript); await mkdir(transcript);
      assert.equal(await sync.synchronizeFile(transcript), null);
      await rm(transcript, { recursive: true });
      assert.equal(await sync.synchronize(new Date(Date.now() + 10000)), 0);
      assert.equal((sync as unknown as { deferredFiles: Set<string> }).deferredFiles.size, 0);
    });
  } finally { restore(); await rm(root, { recursive: true, force: true }); }
});


test('metadata-only first records do not hide the first visible AGY prompt title', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agy-visible-title-'));
  const restore = patchHomeDir(root);
  try {
    const transcript = await writeAntigravityTranscript(root, 'title-native');
    await writeFile(transcript, [
      { source: 'USER_EXPLICIT', type: 'USER_INPUT', content: '<ADDITIONAL_METADATA>hidden</ADDITIONAL_METADATA>' },
      { source: 'USER_EXPLICIT', type: 'USER_INPUT', content: 'Visible prompt' },
    ].map(x => JSON.stringify(x)).join('\n'));
    await writeFile(path.join(root, '.gemini', 'antigravity-cli', 'history.jsonl'), JSON.stringify({ conversationId: 'title-native', workspace: root }));
    await withIsolatedDatabase(async () => {
      await new AntigravitySessionSynchronizer().synchronizeFile(transcript);
      assert.equal(sessionsDb.getSessionByProviderSessionId('title-native')?.custom_name, 'Visible prompt');
    });
  } finally { restore(); await rm(root, { recursive: true, force: true }); }
});


test('AGY restores native terminal errors when the transcript is missing', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agy-missing-history-'));
  const restore = patchHomeDir(root);
  try {
    const directory = path.join(root, '.gemini', 'antigravity-cli', 'conversations');
    await mkdir(directory, { recursive: true });
    const db = new Database(path.join(directory, 'native-error.db'));
    db.exec('CREATE TABLE steps (idx INTEGER PRIMARY KEY, step_type INTEGER, step_payload BLOB)');
    db.prepare('INSERT INTO steps VALUES (?, ?, ?)').run(0, 17,
      encodeWireField(24, encodeWireField(3, encodeWireField(1, Buffer.from('Native failure')))));
    db.close();
    const result = await new AntigravitySessionsProvider().fetchHistory('app', { providerSessionId: 'native-error', jsonlPath: path.join(root, 'missing.jsonl') });
    assert.equal(result.total, 1);
    assert.equal(result.messages[0].kind, 'error');
    assert.equal(result.messages[0].content, 'Native failure');
  } finally { restore(); await rm(root, { recursive: true, force: true }); }
});

test('AGY synchronization excludes backup transcripts from both indexing entrypoints', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agy-canonical-transcript-'));
  const restore = patchHomeDir(root);
  try {
    await withIsolatedDatabase(async () => {
      const id = 'canonical-id';
      const canonical = await writeAntigravityTranscript(root, id);
      const native = path.join(root, '.gemini', 'antigravity-cli');
      await writeFile(path.join(native, 'history.jsonl'), JSON.stringify({ conversationId: id, workspace: root }) + '\n');
      const synchronizer = new AntigravitySessionSynchronizer();
      assert.ok(await synchronizer.synchronizeFile(canonical));
      const backup = path.join(native, 'brain', id, 'backup', 'transcript.jsonl');
      await mkdir(path.dirname(backup), { recursive: true });
      await writeFile(backup, JSON.stringify({ source: 'USER_EXPLICIT', type: 'USER_INPUT', content: 'backup' }));
      assert.equal(await synchronizer.synchronizeFile(backup), null);
      await synchronizer.synchronize();
      assert.equal(sessionsDb.getSessionByProviderSessionId(id)?.jsonl_path, canonical);
    });
  } finally { restore(); await rm(root, { recursive: true, force: true }); }
});

test('review regression: a startup rescan preserves an archived unchanged native transcript', { concurrency: false }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agy-archived-restart-'));
  const restore = patchHomeDir(root);
  try {
    await writeAntigravityTranscript(root, 'archived-native');
    await writeFile(path.join(root, '.gemini', 'antigravity-cli', 'history.jsonl'),
      JSON.stringify({ conversationId: 'archived-native', workspace: root }));
    await withIsolatedDatabase(async () => {
      await new AntigravitySessionSynchronizer().synchronize();
      sessionsDb.updateSessionIsArchived('archived-native', true);
      await new AntigravitySessionSynchronizer().synchronize(new Date(Date.now() + 60000));
      assert.equal(sessionsDb.getSessionById('archived-native')?.isArchived, 1);
    });
  } finally { restore(); await rm(root, { recursive: true, force: true }); }
});


test('review-2 regression: history service observes native-only terminal errors after an unchanged transcript', { concurrency: false }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agy-native-cache-'));
  const restore = patchHomeDir(root);
  try {
    const nativeId = 'native-cache';
    const transcript = await writeAntigravityTranscript(root, nativeId);
    const directory = path.join(root, '.gemini', 'antigravity-cli', 'conversations');
    await mkdir(directory, { recursive: true });
    const native = new Database(path.join(directory, `${nativeId}.db`));
    try {
      native.exec('CREATE TABLE steps (idx INTEGER PRIMARY KEY, step_type INTEGER, step_payload BLOB)');
      await withIsolatedDatabase(async () => {
        sessionsDb.createSession(nativeId, 'antigravity', root, 'Cache test', undefined, undefined, transcript);
        assert.equal((await sessionsService.fetchHistory(nativeId)).messages.some(row => row.kind === 'error'), false);
        native.prepare('INSERT INTO steps VALUES (?, ?, ?)').run(20, 17,
          encodeWireField(24, encodeWireField(3, encodeWireField(1, Buffer.from('Native terminal error')))));
        const after = await sessionsService.fetchHistory(nativeId);
        assert.equal(after.messages.at(-1)?.content, 'Native terminal error');
      });
    } finally { native.close(); }
  } finally { restore(); await rm(root, { recursive: true, force: true }); }
});

test('review-2 regression: a transcript removed during its final stat is not reinserted', { concurrency: false }, async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agy-deleted-scan-'));
  const restore = patchHomeDir(root);
  try {
    const transcript = await writeAntigravityTranscript(root, 'deleted-native');
    await writeFile(path.join(root, '.gemini', 'antigravity-cli', 'history.jsonl'),
      JSON.stringify({ conversationId: 'deleted-native', workspace: root }));
    await withIsolatedDatabase(async () => {
      const original = fsp.stat;
      const mocked = t.mock.method(fsp, 'stat', async (...args: Parameters<typeof fsp.stat>) => {
        if (String(args[0]) === transcript) await rm(transcript, { force: true });
        return original(...args);
      });
      syncBuiltinESMExports();
      try {
        assert.equal(await new AntigravitySessionSynchronizer().synchronizeFile(transcript), null);
        assert.equal(mocked.mock.callCount(), 1);
        assert.equal(sessionsDb.getSessionById('deleted-native'), null);
      } finally { mocked.mock.restore(); syncBuiltinESMExports(); }
    });
  } finally { restore(); await rm(root, { recursive: true, force: true }); }
});


test('review-6 regression: history metadata cannot index a partial-only transcript', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agy-partial-only-')); const restore = patchHomeDir(root);
  try {
    // Complete startup discovery before creating the old deferred transcript.
    await mkdir(path.join(root, '.gemini/antigravity-cli/brain'), { recursive: true });
    const sync = new AntigravitySessionSynchronizer();
    await sync.synchronize();
    const transcript = await writeAntigravityTranscript(root, 'partial-only');
    await writeFile(transcript, '{"source":"USER_EXPLICIT"');
    await writeFile(path.join(root, '.gemini/antigravity-cli/history.jsonl'), JSON.stringify({ conversationId: 'partial-only', workspace: root, display: 'Title exists already' }));
    await withIsolatedDatabase(async () => {
      assert.equal(await sync.synchronizeFile(transcript), null);
      assert.equal(sessionsDb.getSessionById('partial-only'), null);
      await writeFile(transcript, JSON.stringify({ source: 'USER_EXPLICIT', type: 'USER_INPUT', content: 'complete', step_index: 0 }) + '\n{"partial":');
      await sync.synchronize(new Date('2099-01-01'));
      assert.ok(sessionsDb.getSessionById('partial-only'));
    });
  } finally { restore(); await rm(root, { recursive: true, force: true }); }
});
