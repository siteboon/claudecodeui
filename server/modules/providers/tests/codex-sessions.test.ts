import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { CodexSessionSynchronizer } from '@/modules/providers/list/codex/codex-session-synchronizer.provider.js';
import {
  CodexSessionsProvider,
  codexFunctionCallToTool,
} from '@/modules/providers/list/codex/codex-sessions.provider.js';

async function writeCodexJsonl(filePath: string, rows: unknown[]) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, rows.map((row) => JSON.stringify(row)).join('\n'), 'utf8');
}

test('Codex sessions provider marks turn_complete as a successful completion', () => {
  const provider = new CodexSessionsProvider();
  const normalized = provider.normalizeMessage({
    type: 'turn_complete',
    uuid: 'codex-turn-complete-1',
    timestamp: '2026-07-03T14:00:00.000Z',
  }, 'codex-session-1');
  assert.equal(normalized.length, 1);
  assert.equal(normalized[0]?.kind, 'complete');
  assert.equal(normalized[0]?.provider, 'codex');
  assert.equal(normalized[0]?.sessionId, 'codex-session-1');
  assert.equal(normalized[0]?.exitCode, 0);
  assert.equal(normalized[0]?.success, true);
  assert.equal(normalized[0]?.aborted, false);
});

test('Codex synchronizer skips subagent transcripts', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'codex-subagent-sync-'));
  const filePath = path.join(dir, 'child.jsonl');
  await writeCodexJsonl(filePath, [{
    type: 'session_meta',
    payload: {
      id: 'child-1',
      cwd: '/workspace/demo',
      thread_source: 'subagent',
      parent_thread_id: 'parent-1',
    },
  }]);

  const synchronizer = new CodexSessionSynchronizer();

  assert.equal(await synchronizer.synchronizeFile(filePath), null);
});

test('Codex history exposes spawned agent transcript as Task subagent tools', () => {
  const provider = new CodexSessionsProvider();

  const normalized = provider.normalizeMessage({
    type: 'tool_use',
    timestamp: '2026-07-06T14:30:42.142Z',
    toolName: 'Task',
    toolInput: {
      subagent_type: 'Ramanujan',
      description: 'banner-test',
      prompt: 'Create a todo list',
    },
    toolCallId: 'call_spawn',
    subagentTools: [
      {
        toolId: 'call_plan',
        toolName: 'TodoList',
        timestamp: '2026-07-06T14:30:49.657Z',
        toolInput: {
          items: [
            { text: 'say hello', status: 'completed' },
            { text: 'say bye', status: 'completed' },
            { text: 'say thanks', status: 'completed' },
          ],
        },
        toolResult: { content: 'Plan updated', isError: false },
      },
    ],
  }, 'parent-1');

  assert.equal(normalized.length, 1);
  assert.equal(normalized[0]?.kind, 'tool_use');
  assert.equal(normalized[0]?.toolName, 'Task');
  assert.deepEqual(normalized[0]?.subagentTools, [
    {
      toolId: 'call_plan',
      toolName: 'TodoList',
      timestamp: '2026-07-06T14:30:49.657Z',
      toolInput: {
        items: [
          { text: 'say hello', status: 'completed' },
          { text: 'say bye', status: 'completed' },
          { text: 'say thanks', status: 'completed' },
        ],
      },
      toolResult: { content: 'Plan updated', isError: false },
    },
  ]);
});

test('Codex update_plan function call is exposed as TodoList child tool', () => {
  const tool = codexFunctionCallToTool({
    timestamp: '2026-07-06T14:30:49.657Z',
    type: 'response_item',
    payload: {
      type: 'function_call',
      name: 'update_plan',
      call_id: 'call_plan',
      arguments: JSON.stringify({
        plan: [
          { step: 'say hello', status: 'completed' },
          { step: 'say bye', status: 'in_progress' },
        ],
      }),
    },
  });

  assert.deepEqual(tool, {
    type: 'tool_use',
    timestamp: '2026-07-06T14:30:49.657Z',
    toolName: 'TodoList',
    toolInput: {
      items: [
        { text: 'say hello', status: 'completed' },
        { text: 'say bye', status: 'in_progress' },
      ],
    },
    toolCallId: 'call_plan',
  });
});
