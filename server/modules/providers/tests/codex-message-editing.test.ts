import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, initializeDatabase, sessionsDb } from '@/modules/database/index.js';
import { codexAppServer } from '@/modules/providers/list/codex/codex-app-server.client.js';
import { CodexSessionSynchronizer } from '@/modules/providers/list/codex/codex-session-synchronizer.provider.js';
import { CodexSessionsProvider } from '@/modules/providers/list/codex/codex-sessions.provider.js';

/**
 * Codex rows carry no id of their own, so an edit addresses the enclosing
 * *turn*. These cover the two halves of that: that the reader can name the
 * turn a prompt belongs to, and that a turn the thread has retired is never
 * offered as one.
 */

const patchHomeDir = (nextHomeDir: string) => {
  const original = os.homedir;
  (os as any).homedir = () => nextHomeDir;
  return () => {
    (os as any).homedir = original;
  };
};

async function withIsolatedDatabase(runTest: () => void | Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'codex-edit-db-'));

  closeConnection();
  process.env.DATABASE_PATH = path.join(tempDirectory, 'auth.db');
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

type TranscriptRow = Record<string, unknown>;

/** One completed turn: the bracket rows that name it, plus its prompt(s). */
function turn(turnId: string, prompts: string[]): TranscriptRow[] {
  return [
    { type: 'event_msg', payload: { type: 'task_started', turn_id: turnId } },
    { type: 'turn_context', payload: { turn_id: turnId, cwd: '/tmp' } },
    ...prompts.map((message) => ({ type: 'event_msg', payload: { type: 'user_message', message } })),
    { type: 'event_msg', payload: { type: 'agent_message', message: `answer to ${prompts[0]}` } },
    { type: 'event_msg', payload: { type: 'task_complete', turn_id: turnId } },
  ];
}

async function writeRollout(
  homeDir: string,
  threadId: string,
  workspacePath: string,
  rows: TranscriptRow[],
): Promise<string> {
  const sessionsDir = path.join(homeDir, '.codex', 'sessions', '2026', '07', '07');
  await mkdir(sessionsDir, { recursive: true });
  const lines = [
    JSON.stringify({ type: 'session_meta', payload: { id: threadId, cwd: workspacePath } }),
    ...rows.map((row) => JSON.stringify(row)),
  ];
  const filePath = path.join(sessionsDir, `rollout-${threadId}.jsonl`);
  await writeFile(filePath, `${lines.join('\n')}\n`, 'utf8');
  return filePath;
}

/** Stands up an indexed Codex session from a set of transcript rows. */
async function withIndexedSession(
  rows: TranscriptRow[],
  runTest: (context: { sessionId: string; workspacePath: string; homeDir: string }) => Promise<void>,
): Promise<void> {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'codex-edit-'));
  const workspacePath = path.join(tempRoot, 'workspace');
  await mkdir(workspacePath, { recursive: true });
  const restoreHomeDir = patchHomeDir(tempRoot);

  try {
    await writeRollout(tempRoot, 'thread-1', workspacePath, rows);
    await withIsolatedDatabase(async () => {
      await new CodexSessionSynchronizer().synchronize();
      await runTest({ sessionId: 'thread-1', workspacePath, homeDir: tempRoot });
    });
  } finally {
    restoreHomeDir();
    await rm(tempRoot, { recursive: true, force: true });
  }
}

const THREE_TURNS = [
  ...turn('turn-a', ['first prompt']),
  ...turn('turn-b', ['second prompt']),
  ...turn('turn-c', ['third prompt']),
];

test('every Codex prompt is anchored to the turn that contains it', { concurrency: false }, async () => {
  await withIndexedSession(THREE_TURNS, async ({ sessionId }) => {
    const history = await new CodexSessionsProvider().fetchHistory(sessionId);
    const prompts = history.messages.filter((message) => message.role === 'user');

    assert.deepEqual(
      prompts.map((message) => [message.content, message.transcriptAnchorId]),
      [
        ['first prompt', 'turn-a'],
        ['second prompt', 'turn-b'],
        ['third prompt', 'turn-c'],
      ],
    );
    // An anchor on an answer would put a pencil on a message that cannot be
    // edited, so only prompts carry one.
    assert.equal(
      history.messages.some((message) => message.role !== 'user' && message.transcriptAnchorId),
      false,
    );
  });
});

test('only the first prompt of a turn is anchored', { concurrency: false }, async () => {
  // A follow-up typed while a turn is running is recorded inside that same
  // turn. The cut is per turn, so anchoring the follow-up would silently take
  // the prompt before it as well.
  await withIndexedSession(turn('turn-a', ['first prompt', 'queued follow-up']), async ({ sessionId }) => {
    const history = await new CodexSessionsProvider().fetchHistory(sessionId);
    const prompts = history.messages.filter((message) => message.role === 'user');

    assert.deepEqual(
      prompts.map((message) => [message.content, message.transcriptAnchorId]),
      [
        ['first prompt', 'turn-a'],
        ['queued follow-up', undefined],
      ],
    );
  });
});

test('a turn the thread rolled back keeps its rows but loses its anchor', { concurrency: false }, async () => {
  const rows = [
    ...turn('turn-a', ['first prompt']),
    ...turn('turn-b', ['abandoned prompt']),
    { type: 'event_msg', payload: { type: 'thread_rolled_back', num_turns: 1 } },
    ...turn('turn-c', ['replacement prompt']),
  ];

  await withIndexedSession(rows, async ({ sessionId }) => {
    const provider = new CodexSessionsProvider();
    const history = await provider.fetchHistory(sessionId);
    const prompts = history.messages.filter((message) => message.role === 'user');

    assert.deepEqual(
      prompts.map((message) => [message.content, message.transcriptAnchorId]),
      [
        ['first prompt', 'turn-a'],
        // Still rendered — it is what the conversation looked like — but the
        // turn is gone from the thread and the fork endpoint would reject it.
        ['abandoned prompt', undefined],
        ['replacement prompt', 'turn-c'],
      ],
    );

    assert.deepEqual(
      await provider.resolveEditAnchor(sessionId, 'turn-b'),
      { found: false, resumeThroughId: null },
    );
    // turn-b is out of the sequence, so turn-c resumes through turn-a.
    assert.deepEqual(
      await provider.resolveEditAnchor(sessionId, 'turn-c'),
      { found: true, resumeThroughId: 'turn-a' },
    );
  });
});

test('the edit anchor resolves to the turn before the one being replaced', { concurrency: false }, async () => {
  await withIndexedSession(THREE_TURNS, async ({ sessionId }) => {
    const provider = new CodexSessionsProvider();

    assert.deepEqual(
      await provider.resolveEditAnchor(sessionId, 'turn-c'),
      { found: true, resumeThroughId: 'turn-b' },
    );
    // Nothing precedes the first prompt, so the conversation starts over.
    assert.deepEqual(
      await provider.resolveEditAnchor(sessionId, 'turn-a'),
      { found: true, resumeThroughId: null },
    );
    assert.deepEqual(
      await provider.resolveEditAnchor(sessionId, 'turn-nope'),
      { found: false, resumeThroughId: null },
    );
  });
});

test('rewinding a Codex session moves it onto the branch and retires the old thread', { concurrency: false }, async () => {
  await withIndexedSession(THREE_TURNS, async ({ sessionId, homeDir, workspacePath }) => {
    const forkPath = path.join(homeDir, '.codex', 'sessions', '2026', '07', '08', 'rollout-thread-2.jsonl');
    await mkdir(path.dirname(forkPath), { recursive: true });
    await writeFile(forkPath, `${JSON.stringify({ type: 'session_meta', payload: { id: 'thread-2', cwd: workspacePath } })}\n`, 'utf8');

    const realForkThread = codexAppServer.forkThread;
    const forkCalls: unknown[] = [];
    codexAppServer.forkThread = async (input) => {
      forkCalls.push(input);
      return { threadId: 'thread-2', path: forkPath };
    };

    try {
      await new CodexSessionsProvider().rewindSession(sessionId, 'turn-b');
    } finally {
      codexAppServer.forkThread = realForkThread;
    }

    assert.deepEqual(forkCalls, [{ threadId: 'thread-1', lastTurnId: 'turn-b', cwd: workspacePath }]);

    const session = sessionsDb.getSessionById(sessionId);
    assert.equal(session?.provider_session_id, 'thread-2');
    // Not `COALESCE`d onto the old path: the session reads its transcript from
    // here, and leaving it on the pre-edit file would serve the conversation
    // the user just edited away from, for good.
    assert.equal(session?.jsonl_path, forkPath);
    assert.equal(sessionsDb.isProviderSessionSuperseded('thread-1', 'codex'), true);
  });
});

test('editing the first prompt starts the conversation over', { concurrency: false }, async () => {
  await withIndexedSession(THREE_TURNS, async ({ sessionId }) => {
    const realForkThread = codexAppServer.forkThread;
    let forked = false;
    codexAppServer.forkThread = async () => {
      forked = true;
      throw new Error('a fork of no turns should never be attempted');
    };

    try {
      await new CodexSessionsProvider().rewindSession(sessionId, null);
    } finally {
      codexAppServer.forkThread = realForkThread;
    }

    assert.equal(forked, false);
    const session = sessionsDb.getSessionById(sessionId);
    assert.equal(session?.provider_session_id, null);
    assert.equal(session?.jsonl_path, null);
    assert.equal(sessionsDb.isProviderSessionSuperseded('thread-1', 'codex'), true);
  });
});

test('the indexer does not hand back a thread a session was edited off', { concurrency: false }, async () => {
  await withIndexedSession(THREE_TURNS, async ({ sessionId, homeDir, workspacePath }) => {
    const forkPath = path.join(homeDir, '.codex', 'sessions', '2026', '07', '08', 'rollout-thread-2.jsonl');
    await mkdir(path.dirname(forkPath), { recursive: true });
    await writeFile(forkPath, `${JSON.stringify({ type: 'session_meta', payload: { id: 'thread-2', cwd: workspacePath } })}\n`, 'utf8');

    const realForkThread = codexAppServer.forkThread;
    codexAppServer.forkThread = async () => ({ threadId: 'thread-2', path: forkPath });
    try {
      await new CodexSessionsProvider().rewindSession(sessionId, 'turn-b');
    } finally {
      codexAppServer.forkThread = realForkThread;
    }

    // The pre-edit transcript is still on disk on purpose. A full rescan finds
    // it again, and for a session discovered from disk — whose app id is its
    // original thread id — reindexing it would point the row straight back at
    // the conversation the edit replaced.
    await new CodexSessionSynchronizer().synchronize();

    const session = sessionsDb.getSessionById(sessionId);
    assert.equal(session?.provider_session_id, 'thread-2');
    assert.equal(session?.jsonl_path, forkPath);
  });
});

test('deleting an edited session removes every transcript it lived in', { concurrency: false }, async () => {
  await withIndexedSession(THREE_TURNS, async ({ sessionId, homeDir, workspacePath }) => {
    const { sessionsService } = await import('@/modules/providers/services/sessions.service.js');
    const preEditPath = sessionsDb.getSessionById(sessionId)?.jsonl_path as string;
    const forkPath = path.join(homeDir, '.codex', 'sessions', '2026', '07', '08', 'rollout-thread-2.jsonl');
    await mkdir(path.dirname(forkPath), { recursive: true });
    await writeFile(forkPath, `${JSON.stringify({ type: 'session_meta', payload: { id: 'thread-2', cwd: workspacePath } })}\n`, 'utf8');

    const realForkThread = codexAppServer.forkThread;
    codexAppServer.forkThread = async () => ({ threadId: 'thread-2', path: forkPath });
    try {
      await new CodexSessionsProvider().rewindSession(sessionId, 'turn-b');
    } finally {
      codexAppServer.forkThread = realForkThread;
    }

    await sessionsService.deleteOrArchiveSessionById(sessionId, { force: true, deletedFromDisk: true });

    // The row only ever points at the newest transcript, so deleting from that
    // alone would leave the replaced turns on disk — and unreachable, because
    // the indexer refuses a superseded thread.
    assert.equal(existsSync(forkPath), false);
    assert.equal(existsSync(preEditPath), false);
    assert.equal(sessionsDb.isProviderSessionSuperseded('thread-1', 'codex'), false);
  });
});

test('a session detached by an edit reports no token usage of its own', { concurrency: false }, async () => {
  const spentTurns = [
    ...THREE_TURNS,
    {
      type: 'event_msg',
      payload: {
        type: 'token_count',
        info: {
          total_token_usage: { input_tokens: 100_000, output_tokens: 25_000, total_tokens: 125_000 },
          model_context_window: 200_000,
        },
      },
    },
  ];

  await withIndexedSession(spentTurns, async ({ sessionId }) => {
    const { createProviderTokenUsageService } = await import('@/modules/providers/services/provider-token-usage.service.js');
    const service = createProviderTokenUsageService();

    assert.equal((await service.getSessionTokenUsage(sessionId)).used, 125_000);

    await new CodexSessionsProvider().rewindSession(sessionId, null);

    // A session discovered from disk is keyed by its own thread id, so the
    // "no provider id was ever recorded" fallback resolves the very thread the
    // edit discarded — by filename, which still matches — and an empty
    // conversation reports the spent context of the one it replaced.
    const usage = await service.getSessionTokenUsage(sessionId);
    assert.equal(usage.used, 0);
    assert.equal(usage.inputTokens, 0);
  });
});

/**
 * Everything above stubs the app-server. This one runs the real thing, because
 * the whole feature rests on a protocol this repo does not own: that
 * `thread/fork` exists without asking for experimental capabilities, that
 * `lastTurnId` is inclusive, and that the copy is a rollout of its own rather
 * than a pointer at the original.
 */
test('codex app-server forks a real thread at a turn', { concurrency: false }, async (t) => {
  const require_ = createRequire(import.meta.url);
  try {
    require_.resolve('@openai/codex/bin/codex.js');
  } catch {
    t.skip('the Codex CLI package is not installed');
    return;
  }

  const fixture = path.join(
    process.cwd(),
    'temp-jsonls/codex/ask and todolist',
    'rollout-2026-08-22T20-24-44-01a02a80-dfb9-7882-8013-00e41955e656.jsonl',
  );
  const { readFile } = await import('node:fs/promises');
  let transcript: string;
  try {
    transcript = await readFile(fixture, 'utf8');
  } catch {
    t.skip('the committed Codex rollout fixture is not available');
    return;
  }

  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'codex-appserver-'));
  const previousCodexHome = process.env.CODEX_HOME;
  process.env.CODEX_HOME = tempRoot;

  try {
    const sessionsDir = path.join(tempRoot, 'sessions', '2026', '08', '22');
    await mkdir(sessionsDir, { recursive: true });
    await writeFile(path.join(sessionsDir, path.basename(fixture)), transcript, 'utf8');

    const workspacePath = path.join(tempRoot, 'workspace');
    await mkdir(workspacePath, { recursive: true });

    const fork = await codexAppServer.forkThread({
      threadId: '01a02a80-dfb9-7882-8013-00e41955e656',
      // The fixture's second turn; the third must not survive the cut.
      lastTurnId: '01a02a81-2427-7853-b5e2-6eee36690146',
      cwd: workspacePath,
    });

    assert.notEqual(fork.threadId, '01a02a80-dfb9-7882-8013-00e41955e656');

    const copy = await readFile(fork.path, 'utf8');
    const prompts = copy
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as { type?: string; payload?: Record<string, unknown> })
      .filter((row) => row.type === 'event_msg' && row.payload?.type === 'user_message')
      .map((row) => String(row.payload?.message ?? '').trim());

    assert.deepEqual(prompts, [
      'ask me a question using ur ask tool...wanted to check somehting',
      'anytning...just wanted to test',
    ]);

    // The source is a copy source, not a move source.
    const source = await readFile(path.join(sessionsDir, path.basename(fixture)), 'utf8');
    assert.equal(source, transcript);
  } finally {
    if (previousCodexHome === undefined) {
      delete process.env.CODEX_HOME;
    } else {
      process.env.CODEX_HOME = previousCodexHome;
    }
    await rm(tempRoot, { recursive: true, force: true });
  }
});
