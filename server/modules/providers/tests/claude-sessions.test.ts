import assert from 'node:assert/strict';
import test from 'node:test';

import { ClaudeSessionsProvider } from '@/modules/providers/list/claude/claude-sessions.provider.js';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { ClaudeSessionSynchronizer } from '@/modules/providers/list/claude/claude-session-synchronizer.provider.js';

test('Claude sessions provider unwraps SDK stream_event text deltas', () => {
  const provider = new ClaudeSessionsProvider();

  const normalized = provider.normalizeMessage({
    type: 'stream_event',
    event: {
      type: 'content_block_delta',
      delta: { text: 'hello' },
    },
  }, 'claude-session-1');

  assert.equal(normalized.length, 1);
  assert.equal(normalized[0]?.kind, 'stream_delta');
  assert.equal(normalized[0]?.content, 'hello');
  assert.equal(normalized[0]?.provider, 'claude');
  assert.equal(normalized[0]?.sessionId, 'claude-session-1');
});

test('Claude sessions provider unwraps SDK stream_event thinking deltas', () => {
  const provider = new ClaudeSessionsProvider();

  const normalized = provider.normalizeMessage({
    type: 'stream_event',
    event: {
      type: 'content_block_delta',
      delta: { thinking: 'reasoning' },
    },
  }, 'claude-session-1');

  assert.equal(normalized.length, 1);
  assert.equal(normalized[0]?.kind, 'stream_delta');
  assert.equal(normalized[0]?.content, 'reasoning');
});

test('Claude sessions provider unwraps SDK stream_event message_stop', () => {
  const provider = new ClaudeSessionsProvider();

  const normalized = provider.normalizeMessage({
    type: 'stream_event',
    event: { type: 'message_stop' },
  }, 'claude-session-1');

  assert.equal(normalized.length, 1);
  assert.equal(normalized[0]?.kind, 'stream_end');
  assert.equal(normalized[0]?.provider, 'claude');
});

test('Claude sessions provider ignores malformed SDK stream_event wrappers', () => {
  const provider = new ClaudeSessionsProvider();

  assert.deepEqual(provider.normalizeMessage({ type: 'stream_event' }, 'claude-session-1'), []);
});

test('Claude synchronizer skips internal subagent transcript paths', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'claude-subagent-sync-'));
  const filePath = path.join(dir, 'parent-session', 'subagents', 'agent-child.jsonl');
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(
    filePath,
    [
      JSON.stringify({
        type: 'user',
        sessionId: 'parent-session',
        cwd: '/workspace/demo',
        message: { role: 'user', content: 'subagent work' },
      }),
    ].join('\n'),
    'utf8',
  );
  const synchronizer = new ClaudeSessionSynchronizer();

  assert.equal(await synchronizer.synchronizeFile(filePath), null);
});
