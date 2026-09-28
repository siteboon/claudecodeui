import assert from 'node:assert/strict';
import { appendFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';

import { Codex } from '@openai/codex-sdk';
import type { Thread } from '@openai/codex-sdk';

import { closeConnection, initializeDatabase, sessionsDb, unrecordedPromptsDb } from '@/modules/database/index.js';
import { codexRuntime } from '@/modules/providers/list/codex/codex-runtime.provider.js';
import { CodexSessionSynchronizer } from '@/modules/providers/list/codex/codex-session-synchronizer.provider.js';
import { CodexSessionsProvider } from '@/modules/providers/list/codex/codex-sessions.provider.js';
import type { NormalizedMessage, ProviderRuntimeContext } from '@/shared/types.js';

/**
 * A real rollout written by the vendored codex-cli 0.153.4 through
 * @openai/codex-sdk (the path the app uses), trimmed of instruction payloads.
 * It holds three runs of one thread, each beginning at a row that is not part
 * of a turn (`session_meta`, then `thread_settings_applied` for resumes):
 * 1. "FIX2-1353 A1 first prompt", answered.
 * 2. A resume with `model_auto_compact_token_limit=1` while the API answered
 *    429 usage_limit_reached. The pre-turn compaction failed, and all Codex
 *    wrote is `task_started` + `task_complete{error}` — no prompt.
 * 3. "FIX2-1353 A3 control no append", answered.
 */
const FIXTURE_PATH = fileURLToPath(
  new URL('./fixtures/codex-resumed-turn-compaction-failed.rollout.jsonl', import.meta.url),
);
const THREAD_ID = '01a0cff3-5219-7b91-ac21-83f1a9fd44e7';
const FIRST_TURN_ID = '01a0cff3-5280-7b92-b7a6-7bb6d8f914af';
const FAILED_TURN_ID = '01a0cff3-82f3-7d41-85e8-1b5f2ec6ab15';
const FIRST_PROMPT = 'FIX2-1353 A1 first prompt';
const LOST_PROMPT = 'FIX2-1353 A2 prompt sent at the usage limit';
const THIRD_PROMPT = 'FIX2-1353 A3 control no append';
const APP_SESSION_ID = 'app-session-1353';

const patchHomeDir = (nextHomeDir: string) => {
  const original = os.homedir;
  (os as any).homedir = () => nextHomeDir;
  return () => {
    (os as any).homedir = original;
  };
};

async function withIsolatedDatabase(runTest: () => void | Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'codex-unrecorded-db-'));

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

/** The fixture's rows grouped by the run that wrote them. */
async function readFixtureRuns(workspacePath: string): Promise<string[][]> {
  const lines = (await readFile(FIXTURE_PATH, 'utf8'))
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => line.replaceAll('__WORKSPACE__', workspacePath));

  const runs: string[][] = [];
  for (const line of lines) {
    const entry = JSON.parse(line);
    if (entry.type === 'session_meta' || entry.payload?.type === 'thread_settings_applied') {
      runs.push([]);
    }
    runs[runs.length - 1].push(line);
  }
  return runs;
}

/**
 * Stands in for one `codex exec resume` process: it writes the run's rollout
 * rows, streams the events the real binary emitted for that run, and ends the
 * way the SDK does — by throwing its exit error when the process exited 1.
 */
function createScriptedThread(rolloutPath: string, rows: string[], events: unknown[], exitError?: string): Thread {
  return {
    id: THREAD_ID,
    async runStreamed() {
      return {
        events: (async function* () {
          await appendFile(rolloutPath, `${rows.join('\n')}\n`, 'utf8');
          for (const event of events) {
            yield event;
          }
          if (exitError) {
            throw new Error(exitError);
          }
        })(),
      };
    },
  } as unknown as Thread;
}

const runtimeContext: ProviderRuntimeContext = {
  resolveProviderSessionId: (sessionId) => sessionsDb.getSessionById(sessionId ?? '')?.provider_session_id ?? null,
  resolveTranscriptPath: (sessionId) => sessionsDb.getSessionById(sessionId)?.jsonl_path ?? null,
  resolveResumeModel: async () => 'gpt-5.4',
  getProviderModels: async () => ({ OPTIONS: [], DEFAULT: 'gpt-5.4' }),
  normalizeMessage: () => [],
  isProviderInstalled: async () => true,
};

async function runResumedTurn(
  t: TestContext,
  prompt: string,
  submittedAt: string,
  thread: Thread,
): Promise<unknown[]> {
  const sent: unknown[] = [];
  const resume = t.mock.method(Codex.prototype, 'resumeThread', () => thread);
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse(submittedAt) });
  try {
    await codexRuntime.run(prompt, { sessionId: APP_SESSION_ID, cwd: process.cwd() }, {
      isWebSocketWriter: true,
      send: (message) => sent.push(message),
    }, runtimeContext);
  } finally {
    t.mock.timers.reset();
    resume.mock.restore();
  }
  assert.equal(resume.mock.callCount(), 1);
  return sent;
}

/** Sets up an app session whose thread has had its first, answered run. */
async function withFirstRunIndexed(
  runTest: (context: { rolloutPath: string; runs: string[][] }) => Promise<void>,
): Promise<void> {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'codex-unrecorded-prompt-'));
  const workspacePath = path.join(tempRoot, 'workspace');
  await mkdir(workspacePath, { recursive: true });
  const restoreHomeDir = patchHomeDir(tempRoot);

  try {
    const runs = await readFixtureRuns(workspacePath);
    const rolloutPath = path.join(tempRoot, '.codex', 'sessions', '2026', '09', '23', `rollout-2026-09-23T20-27-05-${THREAD_ID}.jsonl`);
    await mkdir(path.dirname(rolloutPath), { recursive: true });
    await writeFile(rolloutPath, `${runs[0].join('\n')}\n`, 'utf8');

    await withIsolatedDatabase(async () => {
      sessionsDb.createAppSession(APP_SESSION_ID, 'codex', workspacePath, FIRST_PROMPT);
      sessionsDb.assignProviderSessionId(APP_SESSION_ID, THREAD_ID);
      await new CodexSessionSynchronizer().synchronize();
      assert.equal(sessionsDb.getSessionById(APP_SESSION_ID)?.jsonl_path, rolloutPath);

      await runTest({ rolloutPath, runs });
    });
  } finally {
    restoreHomeDir();
    await rm(tempRoot, { recursive: true, force: true });
  }
}

const visibleText = (messages: NormalizedMessage[]) => messages
  .filter((message) => message.kind === 'text')
  .map((message) => `${message.role}: ${message.content}`);

test('a resumed Codex turn whose compaction failed keeps its prompt after a reload', { concurrency: false }, async (t) => {
  await withFirstRunIndexed(async ({ rolloutPath, runs }) => {
    const failure = JSON.parse(runs[1].at(-1) as string).payload.error.message as string;
    const sent = await runResumedTurn(t, LOST_PROMPT, '2026-09-23T20:27:17.300Z', createScriptedThread(
      rolloutPath,
      runs[1],
      [
        { type: 'thread.started', thread_id: THREAD_ID },
        { type: 'turn.started' },
        { type: 'error', message: failure },
        { type: 'turn.failed', error: { message: failure } },
      ],
      'Codex Exec exited with code 1: Reading prompt from stdin...',
    ));
    assert.ok(sent.some((message: any) => message.kind === 'complete' && message.exitCode === 1));

    // Codex itself wrote no prompt for the failed turn.
    const rollout = await readFile(rolloutPath, 'utf8');
    assert.ok(!rollout.includes(LOST_PROMPT));

    const provider = new CodexSessionsProvider();
    const history = await provider.fetchHistory(APP_SESSION_ID);
    assert.deepEqual(visibleText(history.messages), [
      `user: ${FIRST_PROMPT}`,
      'assistant: FIX2-REPLY 8',
      `user: ${LOST_PROMPT}`,
    ]);

    // Editing the kept prompt cuts at its turn, like any prompt Codex wrote.
    const keptPrompt = history.messages.find((message) => message.content === LOST_PROMPT);
    assert.equal(keptPrompt?.transcriptAnchorId, FAILED_TURN_ID);
    assert.deepEqual(await provider.resolveEditAnchor(APP_SESSION_ID, FAILED_TURN_ID), {
      found: true,
      resumeThroughId: FIRST_TURN_ID,
    });

    // The next turn answers normally and lands after the kept prompt.
    await runResumedTurn(t, THIRD_PROMPT, '2026-09-23T20:28:06.700Z', createScriptedThread(
      rolloutPath,
      runs[2],
      [
        { type: 'thread.started', thread_id: THREAD_ID },
        { type: 'turn.started' },
        { type: 'item.completed', item: { id: 'item_1', type: 'agent_message', text: 'FIX2-REPLY 21' } },
        { type: 'turn.completed', usage: { input_tokens: 6, cached_input_tokens: 0, output_tokens: 6, reasoning_output_tokens: 0 } },
      ],
    ));
    assert.deepEqual(visibleText((await provider.fetchHistory(APP_SESSION_ID)).messages), [
      `user: ${FIRST_PROMPT}`,
      'assistant: FIX2-REPLY 8',
      `user: ${LOST_PROMPT}`,
      `user: ${THIRD_PROMPT}`,
      'assistant: FIX2-REPLY 21',
    ]);
  });
});

test('a resumed Codex turn that recorded its prompt keeps no second copy', { concurrency: false }, async (t) => {
  await withFirstRunIndexed(async ({ rolloutPath, runs }) => {
    await runResumedTurn(t, THIRD_PROMPT, '2026-09-23T20:28:06.700Z', createScriptedThread(
      rolloutPath,
      runs[2],
      [
        { type: 'thread.started', thread_id: THREAD_ID },
        { type: 'turn.started' },
        { type: 'item.completed', item: { id: 'item_1', type: 'agent_message', text: 'FIX2-REPLY 21' } },
        { type: 'turn.completed', usage: { input_tokens: 6, cached_input_tokens: 0, output_tokens: 6, reasoning_output_tokens: 0 } },
      ],
    ));

    assert.deepEqual(unrecordedPromptsDb.listForProviderSession(APP_SESSION_ID, 'codex', THREAD_ID), []);
    assert.deepEqual(visibleText((await new CodexSessionsProvider().fetchHistory(APP_SESSION_ID)).messages), [
      `user: ${FIRST_PROMPT}`,
      'assistant: FIX2-REPLY 8',
      `user: ${THIRD_PROMPT}`,
      'assistant: FIX2-REPLY 21',
    ]);
  });
});

test('a kept Codex prompt is not shown twice once its turn has one', { concurrency: false }, async () => {
  await withFirstRunIndexed(async () => {
    unrecordedPromptsDb.add({
      sessionId: APP_SESSION_ID,
      provider: 'codex',
      providerSessionId: THREAD_ID,
      turnId: FIRST_TURN_ID,
      text: FIRST_PROMPT,
      imagePaths: [],
      submittedAt: '2026-09-23T20:27:05.200Z',
    });

    const history = await new CodexSessionsProvider().fetchHistory(APP_SESSION_ID);
    assert.deepEqual(visibleText(history.messages), [`user: ${FIRST_PROMPT}`, 'assistant: FIX2-REPLY 8']);
  });
});

test('a kept Codex prompt from a run that never opened a turn is placed by time', { concurrency: false }, async () => {
  await withFirstRunIndexed(async () => {
    unrecordedPromptsDb.add({
      sessionId: APP_SESSION_ID,
      provider: 'codex',
      providerSessionId: THREAD_ID,
      turnId: null,
      text: LOST_PROMPT,
      imagePaths: ['/uploads/screenshot.png'],
      submittedAt: '2026-09-23T20:27:17.300Z',
    });
    // Kept for a transcript the session has since left (an edit branched it).
    unrecordedPromptsDb.add({
      sessionId: APP_SESSION_ID,
      provider: 'codex',
      providerSessionId: 'thread-edited-away-from',
      turnId: null,
      text: 'belongs to another transcript',
      imagePaths: [],
      submittedAt: '2026-09-23T20:27:16.000Z',
    });

    const history = await new CodexSessionsProvider().fetchHistory(APP_SESSION_ID);
    assert.deepEqual(visibleText(history.messages), [
      `user: ${FIRST_PROMPT}`,
      'assistant: FIX2-REPLY 8',
      `user: ${LOST_PROMPT}`,
    ]);
    const keptPrompt = history.messages.at(-1);
    assert.equal(keptPrompt?.transcriptAnchorId, undefined);
    assert.deepEqual(keptPrompt?.images, [{ path: '/uploads/screenshot.png' }]);
  });
});
