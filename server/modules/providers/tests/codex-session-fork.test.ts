import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { codexAppServer } from '@/modules/providers/list/codex/codex-app-server.client.js';
import { CodexForkProvider } from '@/modules/providers/list/codex/codex-fork.provider.js';

/**
 * The fork endpoint itself is exercised against the real `codex app-server` in
 * codex-message-editing.test.ts, which is where the rewind that depends on it
 * lives. What is left for the fork provider is the mapping either side of it.
 */

/**
 * A minimal transcript the turn tracker accepts: one `event_msg` row per turn
 * carrying its `turn_id`, which is all `readCodexLiveTurnIds` reads.
 */
function writeTurnTranscript(turnIds: string[]): string {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'codex-fork-')), 'rollout.jsonl');
  const lines = [
    JSON.stringify({ type: 'session_meta', payload: { id: 'thread-1' } }),
    ...turnIds.map((turnId) => JSON.stringify({ type: 'event_msg', payload: { type: 'task_started', turn_id: turnId } })),
  ];
  fs.writeFileSync(file, `${lines.join('\n')}\n`, 'utf8');
  return file;
}

test('a Codex fork asks for the whole thread when no anchor is given', { concurrency: false }, async () => {
  const realForkThread = codexAppServer.forkThread;
  const forkCalls: unknown[] = [];
  codexAppServer.forkThread = async (input) => {
    forkCalls.push(input);
    return { threadId: 'thread-2', path: '/tmp/rollout-thread-2.jsonl' };
  };

  try {
    const forked = await new CodexForkProvider().forkSession({
      providerSessionId: 'thread-1',
      jsonlPath: '/tmp/rollout-thread-1.jsonl',
      projectPath: '/tmp/workspace',
      title: 'ignored by codex',
    });
    assert.deepEqual(forked, { providerSessionId: 'thread-2', jsonlPath: '/tmp/rollout-thread-2.jsonl' });
  } finally {
    codexAppServer.forkThread = realForkThread;
  }

  assert.deepEqual(forkCalls, [{ threadId: 'thread-1', cwd: '/tmp/workspace' }]);
});

test('forking from a message keeps the turns before it, not its own', async () => {
  const transcript = writeTurnTranscript(['turn-a', 'turn-b', 'turn-c']);
  const realForkThread = codexAppServer.forkThread;
  const forkCalls: unknown[] = [];
  codexAppServer.forkThread = async (input) => {
    forkCalls.push(input);
    return { threadId: 'thread-2', path: '/tmp/rollout-thread-2.jsonl' };
  };

  try {
    await new CodexForkProvider().forkSession({
      providerSessionId: 'thread-1',
      jsonlPath: transcript,
      projectPath: '/tmp/workspace',
      upToAnchorId: 'turn-b',
    });
  } finally {
    codexAppServer.forkThread = realForkThread;
  }

  // The contract excludes the anchored message, and `thread/fork`'s
  // `lastTurnId` is inclusive of the turn it names and cuts by turn — so the
  // adapter asks for the turn BEFORE the anchored one. A turn is written as
  // one thing; there is no cut between a prompt and its answer, so excluding
  // the turn is the finest cut the provider can express.
  assert.deepEqual(forkCalls, [{ threadId: 'thread-1', lastTurnId: 'turn-a', cwd: '/tmp/workspace' }]);
});

test('forking from the first message reports there is nothing to copy', async () => {
  const transcript = writeTurnTranscript(['turn-a', 'turn-b']);
  const realForkThread = codexAppServer.forkThread;
  const forkCalls: unknown[] = [];
  codexAppServer.forkThread = async (input) => {
    forkCalls.push(input);
    return { threadId: 'thread-2', path: '/tmp/rollout-thread-2.jsonl' };
  };

  try {
    await assert.rejects(
      () =>
        new CodexForkProvider().forkSession({
          providerSessionId: 'thread-1',
          jsonlPath: transcript,
          projectPath: '/tmp/workspace',
          upToAnchorId: 'turn-a',
        }),
      (error: unknown) =>
        (error as { code?: string }).code === 'FORK_NOTHING_TO_COPY',
    );
  } finally {
    codexAppServer.forkThread = realForkThread;
  }

  // Reporting beats silently forking the whole conversation, which is the
  // opposite of what the user clicked.
  assert.deepEqual(forkCalls, []);
});

test('forking from a message that rolled out of the transcript is refused', async () => {
  const transcript = writeTurnTranscript(['turn-a', 'turn-b']);
  const realForkThread = codexAppServer.forkThread;
  const forkCalls: unknown[] = [];
  codexAppServer.forkThread = async (input) => {
    forkCalls.push(input);
    return { threadId: 'thread-2', path: '/tmp/rollout-thread-2.jsonl' };
  };

  try {
    await assert.rejects(
      () =>
        new CodexForkProvider().forkSession({
          providerSessionId: 'thread-1',
          jsonlPath: transcript,
          projectPath: '/tmp/workspace',
          upToAnchorId: 'turn-gone',
        }),
      (error: unknown) =>
        (error as { code?: string }).code === 'FORK_ANCHOR_NOT_FOUND',
    );
  } finally {
    codexAppServer.forkThread = realForkThread;
  }

  assert.deepEqual(forkCalls, []);
});
