import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, initializeDatabase, sessionsDb } from '@/modules/database/index.js';
import { ClaudeSessionsProvider } from '@/modules/providers/list/claude/claude-sessions.provider.js';

const SESSION_ID = 'claude-model-session';

async function withIsolatedDatabase(runTest: () => void | Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'claude-model-db-'));

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

/**
 * One assistant transcript row in the shape Claude Code writes it: the model
 * that answered sits on `message.model`, beside the content parts.
 */
const assistantRow = (uuid: string, model: string | undefined, content: unknown) => ({
  parentUuid: 'user-1',
  isSidechain: false,
  type: 'assistant',
  uuid,
  timestamp: '2026-07-10T00:00:01.000Z',
  cwd: '/workspace/demo',
  sessionId: SESSION_ID,
  message: { role: 'assistant', ...(model === undefined ? {} : { model }), content },
});

test('an assistant reply carries the model that answered it', () => {
  const messages = new ClaudeSessionsProvider().normalizeMessage(
    assistantRow('asst-1', 'claude-opus-5', [
      { type: 'thinking', thinking: 'weighing the options' },
      { type: 'text', text: 'Here is the plan.' },
      { type: 'tool_use', id: 'toolu_1', name: 'Read', input: { file_path: '/repo/a.ts' } },
    ]),
    SESSION_ID,
  );

  const prose = messages.find((message) => message.kind === 'text');
  assert.equal(prose?.model, 'claude-opus-5');

  // Only prose has a footer to show it in; a tool call and a reasoning block
  // are drawn as cards, so stamping them would carry a model nothing renders.
  assert.equal(messages.find((message) => message.kind === 'tool_use')?.model, undefined);
  assert.equal(messages.find((message) => message.kind === 'thinking')?.model, undefined);
});

test('an assistant reply whose content is a bare string carries the model too', () => {
  const [prose] = new ClaudeSessionsProvider().normalizeMessage(
    assistantRow('asst-2', 'claude-haiku-4-5-20251001', 'Done.'),
    SESSION_ID,
  );

  assert.equal(prose?.kind, 'text');
  assert.equal(prose?.model, 'claude-haiku-4-5-20251001');
});

test('the reported model id is passed through verbatim, suffix and all', () => {
  // Claude Code writes the base id on assistant rows today, even in 1M-context
  // sessions. The normalizer must still never rewrite what the provider wrote:
  // if a `[1m]` id ever appears, it has to reach the client as itself.
  const [prose] = new ClaudeSessionsProvider().normalizeMessage(
    assistantRow('asst-3', 'claude-opus-5[1m]', [{ type: 'text', text: 'Reading the whole repo.' }]),
    SESSION_ID,
  );

  assert.equal(prose?.model, 'claude-opus-5[1m]');
});

test('a locally fabricated row reports no model at all', () => {
  // Claude Code stamps rows it synthesized itself — the usage-limit notice, an
  // API-error placeholder — with `<synthetic>`. No request ran, so there is no
  // model to name, and a guessed one would be a lie about what was charged.
  const [prose] = new ClaudeSessionsProvider().normalizeMessage(
    assistantRow('asst-4', '<synthetic>', [{ type: 'text', text: 'Claude usage limit reached.' }]),
    SESSION_ID,
  );

  assert.equal(prose?.kind, 'text');
  assert.equal(prose?.model, undefined);
});

test('a user turn carries no model, because no transcript records one', () => {
  const [turn] = new ClaudeSessionsProvider().normalizeMessage(
    {
      type: 'user',
      uuid: 'user-1',
      timestamp: '2026-07-10T00:00:00.000Z',
      sessionId: SESSION_ID,
      message: { role: 'user', content: 'Plan the refactor.' },
    },
    SESSION_ID,
  );

  assert.equal(turn?.role, 'user');
  assert.equal(turn?.model, undefined);
});

test('Claude history replays the model of every assistant turn from the transcript', { concurrency: false }, async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'claude-model-history-'));

  try {
    const transcriptPath = path.join(tempRoot, `${SESSION_ID}.jsonl`);
    await writeFile(
      transcriptPath,
      [
        JSON.stringify({
          parentUuid: null,
          isSidechain: false,
          type: 'user',
          uuid: 'user-1',
          timestamp: '2026-07-10T00:00:00.000Z',
          cwd: '/workspace/demo',
          sessionId: SESSION_ID,
          message: { role: 'user', content: 'Plan the refactor.' },
        }),
        JSON.stringify(assistantRow('asst-1', 'claude-opus-5', [{ type: 'text', text: 'Here is the plan.' }])),
        JSON.stringify(assistantRow('asst-2', '<synthetic>', [{ type: 'text', text: 'Claude usage limit reached.' }])),
        '',
      ].join('\n'),
      'utf8',
    );

    await withIsolatedDatabase(async () => {
      const now = new Date().toISOString();
      sessionsDb.createSession(SESSION_ID, 'claude', tempRoot, 'Model session', now, now, transcriptPath);

      const history = await new ClaudeSessionsProvider().fetchHistory(SESSION_ID, {
        providerSessionId: SESSION_ID,
      });

      const replies = history.messages.filter((message) => message.kind === 'text' && message.role === 'assistant');
      assert.equal(replies.length, 2);
      assert.equal(replies[0]?.model, 'claude-opus-5');
      assert.equal(replies[1]?.model, undefined);
      assert.equal(history.messages.find((message) => message.role === 'user')?.model, undefined);
    });
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});
