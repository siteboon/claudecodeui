import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  findCodexSubagentTranscriptFiles,
  isCodexSubagentTranscript,
  readCodexTranscriptMeta,
} from '@/modules/providers/list/codex/codex-transcripts.js';

async function writeJsonl(filePath: string, rows: unknown[]) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, rows.map((row) => JSON.stringify(row)).join('\n'), 'utf8');
}

test('reads Codex parent and subagent transcript metadata', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'codex-transcripts-'));
  const filePath = path.join(dir, 'subagent.jsonl');

  await writeJsonl(filePath, [
    {
      timestamp: '2026-07-06T14:30:42.203Z',
      type: 'session_meta',
      payload: {
        id: 'child-1',
        cwd: '/workspace/demo',
        thread_source: 'subagent',
        parent_thread_id: 'parent-1',
        agent_nickname: 'Ramanujan',
        agent_role: 'default',
      },
    },
  ]);

  const meta = await readCodexTranscriptMeta(filePath);

  assert.deepEqual(meta, {
    sessionId: 'child-1',
    projectPath: '/workspace/demo',
    threadSource: 'subagent',
    parentThreadId: 'parent-1',
    agentNickname: 'Ramanujan',
    agentRole: 'default',
  });
  assert.equal(await isCodexSubagentTranscript(filePath), true);
});

test('finds subagent transcripts for one parent thread', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'codex-transcripts-'));
  const parentMatch = path.join(dir, '2026', '07', '06', 'child-match.jsonl');
  const otherParent = path.join(dir, '2026', '07', '06', 'child-other.jsonl');
  const normalSession = path.join(dir, '2026', '07', '06', 'parent.jsonl');

  await writeJsonl(parentMatch, [
    {
      type: 'session_meta',
      payload: {
        id: 'child-match',
        cwd: '/workspace/demo',
        thread_source: 'subagent',
        parent_thread_id: 'parent-1',
      },
    },
  ]);
  await writeJsonl(otherParent, [
    {
      type: 'session_meta',
      payload: {
        id: 'child-other',
        cwd: '/workspace/demo',
        thread_source: 'subagent',
        parent_thread_id: 'parent-2',
      },
    },
  ]);
  await writeJsonl(normalSession, [
    {
      type: 'session_meta',
      payload: { id: 'parent-1', cwd: '/workspace/demo' },
    },
  ]);

  assert.deepEqual(await findCodexSubagentTranscriptFiles('parent-1', dir), [parentMatch]);
});
