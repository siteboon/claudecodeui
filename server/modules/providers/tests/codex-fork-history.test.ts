import assert from 'node:assert/strict';
import { appendFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, initializeDatabase, sessionsDb } from '@/modules/database/index.js';
import { CodexSessionsProvider } from '@/modules/providers/list/codex/codex-sessions.provider.js';

type Row = Record<string, unknown>;

function turn(id: string, prompt: string): Row[] {
  return [
    { type: 'event_msg', payload: { type: 'task_started', turn_id: id } },
    { type: 'event_msg', payload: { type: 'item_completed', turn_id: id,
      item: { type: 'UserMessage', content: [{ type: 'input_text', text: prompt }] } } },
    { type: 'response_item', payload: { type: 'message', role: 'assistant',
      content: [{ type: 'output_text', text: `answer: ${prompt}` }] } },
    { type: 'event_msg', payload: { type: 'task_complete', turn_id: id } },
  ];
}

function encode(rows: Row[]): string {
  return rows.map((row) => JSON.stringify({ timestamp: '2026-10-08T14:00:00Z', ...row })).join('\n') + '\n';
}

async function withRollouts(run: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'codex-fork-history-'));
  const previous = process.env.DATABASE_PATH;
  closeConnection();
  process.env.DATABASE_PATH = path.join(root, 'auth.db');
  await initializeDatabase();
  try {
    await run(root);
  } finally {
    closeConnection();
    if (previous === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previous;
    await rm(root, { recursive: true, force: true });
  }
}

async function rollout(root: string, id: string, rows: Row[], metadata: Row = {}, index = true): Promise<string> {
  const directory = path.join(root, '.codex', 'sessions', '2026', '10', '08');
  await mkdir(directory, { recursive: true });
  const file = path.join(directory, `rollout-${id}.jsonl`);
  await writeFile(file, encode([{ type: 'session_meta', payload: { id, cwd: root, ...metadata } }, ...rows]));
  if (index) sessionsDb.createSession(id, 'codex', root, id, undefined, undefined, file);
  return file;
}

async function reference(id: string, file: string): Promise<Row> {
  const content = await readFile(file);
  return { history_mode: 'paginated', forked_from_id: id, history_base: {
    thread_id: id, end_ordinal_exclusive: content.toString().split('\n').length - 1,
    end_byte_offset: content.length,
  } };
}

test('metadata-only Codex forks show frozen inherited prompts, replies and edit anchors', async () => {
  await withRollouts(async (root) => {
    const source = await rollout(root, 'source', turn('turn-a', '한글 원본'));
    await rollout(root, 'fork', [], await reference('source', source));
    // A fork remains a snapshot while the source keeps receiving turns.
    await appendFile(source, encode(turn('turn-later', 'must stay on the source')));
    const provider = new CodexSessionsProvider();
    const history = await provider.fetchHistory('fork');
    assert.deepEqual(history.messages.map((message) => message.content), ['한글 원본', 'answer: 한글 원본']);
    assert.equal(history.messages[0].transcriptAnchorId, 'turn-a');
    assert.ok(history.messages.every((message) => message.sessionId === 'fork'));
    assert.deepEqual(await provider.resolveEditAnchor('fork', 'turn-a'), { found: true, resumeThroughId: null });
    assert.equal((await provider.resolveEditAnchor('fork', 'turn-later')).found, false);
  });
});

test('forks of forks combine frozen ancestors and new local turns in order, including pagination', async () => {
  await withRollouts(async (root) => {
    const source = await rollout(root, 'source', turn('turn-a', 'first'));
    const child = await rollout(root, 'child', turn('turn-b', 'second'), await reference('source', source));
    await rollout(root, 'grandchild', turn('turn-c', 'third'), await reference('child', child));
    await appendFile(child, encode(turn('turn-later', 'not inherited')));
    const provider = new CodexSessionsProvider();
    const history = await provider.fetchHistory('grandchild');
    assert.deepEqual(history.messages.map((message) => message.content), [
      'first', 'answer: first', 'second', 'answer: second', 'third', 'answer: third',
    ]);
    assert.deepEqual(await provider.resolveEditAnchor('grandchild', 'turn-c'), { found: true, resumeThroughId: 'turn-b' });
    const page = await provider.fetchHistory('grandchild', { limit: 2, offset: 2 });
    assert.deepEqual(page.messages.map((message) => message.content), ['second', 'answer: second']);
    assert.equal(page.total, 6);
    assert.equal(page.hasMore, true);
  });
});

test('history_base can point at a grandparent rather than the immediate fork source', async () => {
  await withRollouts(async (root) => {
    const source = await rollout(root, 'source', turn('turn-a', 'first'));
    await rollout(root, 'child', turn('turn-b', 'excluded'), await reference('source', source));
    await rollout(root, 'grandchild', [], { ...await reference('source', source), forked_from_id: 'child' });
    const history = await new CodexSessionsProvider().fetchHistory('grandchild');
    assert.deepEqual(history.messages.map((message) => message.content), ['first', 'answer: first']);
  });
});

test('unindexed and archived history sources are resolved from native storage', async () => {
  await withRollouts(async (root) => {
    const source = await rollout(root, 'source', turn('turn-a', 'still available'), {}, false);
    await rollout(root, 'fork', [], await reference('source', source));
    const archived = path.join(root, '.codex', 'archived_sessions');
    await mkdir(archived);
    await writeFile(path.join(archived, 'rollout-source.jsonl'), await readFile(source));
    await rm(source);
    const history = await new CodexSessionsProvider().fetchHistory('fork');
    assert.equal(history.messages[0].content, 'still available');
  });
});

test('copied legacy forks do not duplicate history using forked_from_id', async () => {
  await withRollouts(async (root) => {
    await rollout(root, 'source', turn('turn-a', 'copied'));
    await rollout(root, 'fork', turn('turn-a', 'copied'), { forked_from_id: 'source' });
    assert.equal((await new CodexSessionsProvider().fetchHistory('fork')).messages.length, 2);
  });
});

test('missing and invalid inherited history fail visibly instead of returning an empty conversation', async () => {
  await withRollouts(async (root) => {
    const provider = new CodexSessionsProvider();
    await rollout(root, 'missing', [], { history_base: { thread_id: 'absent', end_byte_offset: 100 } });
    await assert.rejects(provider.fetchHistory('missing'), { code: 'CODEX_HISTORY_SOURCE_UNAVAILABLE' });
    await rollout(root, 'invalid', [], { history_base: { thread_id: '../source', end_byte_offset: -1 } });
    await assert.rejects(provider.fetchHistory('invalid'), { code: 'CODEX_HISTORY_SOURCE_INVALID' });
    const source = await rollout(root, 'source', turn('turn-a', 'short'));
    await rollout(root, 'truncated', [], await reference('source', source));
    await writeFile(source, '');
    await assert.rejects(provider.fetchHistory('truncated'), { code: 'CODEX_HISTORY_SOURCE_INVALID' });
    const cyclic = await rollout(root, 'cycle', [], { history_base: { thread_id: 'cycle', end_byte_offset: 1 } });
    assert.ok(cyclic);
    await assert.rejects(provider.fetchHistory('cycle'), { code: 'CODEX_HISTORY_SOURCE_INVALID' });
  });
});

// Native paginated rollouts preserve ordinals even when their serialized rows
// are rewritten. Give each row its native identity independently of byte size.
async function numberRollout(file: string, firstOrdinal = 0): Promise<void> {
  const rows = (await readFile(file, 'utf8')).trim().split('\n').map((line, index) => ({
    ...JSON.parse(line), ordinal: firstOrdinal + index,
  }));
  await writeFile(file, encode(rows));
}

for (const rewrite of ['shrink', 'grow'] as const) {
  test(`ordinal snapshots survive source rewrites that ${rewrite} its serialized rows`, async () => {
    await withRollouts(async (root) => {
      const source = await rollout(root, 'source', turn('turn-a', '한글 원본'), { padding: 'x'.repeat(4000) });
      await numberRollout(source);
      const snapshot = await reference('source', source);
      await rollout(root, 'fork', turn('turn-child', 'child'), snapshot);
      const rows = (await readFile(source, 'utf8')).trim().split('\n').map((line) => JSON.parse(line));
      rows[0].payload.padding = rewrite === 'shrink' ? '' : 'x'.repeat(8000);
      await writeFile(source, encode(rows));
      await appendFile(source, encode(turn('turn-later', 'must not leak').map((row, index) => ({
        ...row, ordinal: rows.length + index,
      }))));
      const provider = new CodexSessionsProvider();
      const history = await provider.fetchHistory('fork');
      assert.deepEqual(history.messages.map((message) => message.content), [
        '한글 원본', 'answer: 한글 원본', 'child', 'answer: child',
      ]);
      assert.equal((await provider.resolveEditAnchor('fork', 'turn-a')).found, true);
      assert.equal((await provider.resolveEditAnchor('fork', 'turn-later')).found, false);
      const page = await provider.fetchHistory('fork', { limit: 2, offset: 2 });
      assert.deepEqual(page.messages.map((message) => message.content), ['한글 원본', 'answer: 한글 원본']);
    });
  });
}

test('ordinal snapshots expand nested ancestors even when the cut is at child metadata', async () => {
  await withRollouts(async (root) => {
    const source = await rollout(root, 'source', turn('turn-a', 'first'), { padding: 'x'.repeat(4000) });
    await numberRollout(source);
    const child = await rollout(root, 'child', turn('turn-b', 'second'), await reference('source', source));
    await numberRollout(child, 5);
    await rollout(root, 'grandchild', [], { history_base: {
      thread_id: 'child', end_byte_offset: 999999, end_ordinal_exclusive: 5,
    } });
    const rows = (await readFile(source, 'utf8')).trim().split('\n').map((line) => JSON.parse(line));
    rows[0].payload.padding = '';
    await writeFile(source, encode(rows));
    const history = await new CodexSessionsProvider().fetchHistory('grandchild');
    assert.deepEqual(history.messages.map((message) => message.content), ['first', 'answer: first']);
  });
});

test('ordinal snapshots still reject genuinely truncated and invalid source boundaries', async () => {
  await withRollouts(async (root) => {
    const source = await rollout(root, 'source', turn('turn-a', 'first'));
    await numberRollout(source);
    await rollout(root, 'fork', [], await reference('source', source));
    const rows = (await readFile(source, 'utf8')).trim().split('\n');
    await writeFile(source, rows.slice(0, -2).join('\n') + '\n');
    const provider = new CodexSessionsProvider();
    await assert.rejects(provider.fetchHistory('fork'), { code: 'CODEX_HISTORY_SOURCE_INVALID' });
    await rollout(root, 'invalid-ordinal', [], { history_base: {
      thread_id: 'source', end_byte_offset: 1, end_ordinal_exclusive: -1,
    } });
    await assert.rejects(provider.fetchHistory('invalid-ordinal'), { code: 'CODEX_HISTORY_SOURCE_INVALID' });
  });
});
