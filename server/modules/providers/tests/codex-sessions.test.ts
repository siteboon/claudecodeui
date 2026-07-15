import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, initializeDatabase, sessionsDb } from '@/modules/database/index.js';
import { CodexSessionSynchronizer } from '@/modules/providers/list/codex/codex-session-synchronizer.provider.js';
import {
  CodexSessionsProvider,
  codexFunctionCallToTool,
} from '@/modules/providers/list/codex/codex-sessions.provider.js';

async function writeCodexJsonl(filePath: string, rows: unknown[]) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, rows.map((row) => JSON.stringify(row)).join('\n'), 'utf8');
}

const patchHomeDir = (nextHomeDir: string) => {
  const original = os.homedir;
  (os as { homedir: () => string }).homedir = () => nextHomeDir;
  return () => {
    (os as { homedir: () => string }).homedir = original;
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

test('Codex synchronizer skips transcripts marked only via source.subagent', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'codex-subagent-source-sync-'));
  const filePath = path.join(dir, 'child.jsonl');
  await writeCodexJsonl(filePath, [{
    type: 'session_meta',
    payload: {
      id: 'child-2',
      cwd: '/workspace/demo',
      source: { subagent: { thread_spawn: { parent_thread_id: 'parent-1', depth: 1 } } },
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

test('Codex fetchHistory attaches child transcript tools to parent Task rows', async () => {
  await withIsolatedDatabase(async () => {
    const homeDir = await mkdtemp(path.join(os.tmpdir(), 'codex-home-'));
    const restoreHomeDir = patchHomeDir(homeDir);

    try {
      const sessionsRoot = path.join(homeDir, '.codex', 'sessions', '2026', '07', '06');
      const parentFilePath = path.join(sessionsRoot, 'parent.jsonl');
      const childFilePath = path.join(sessionsRoot, 'child.jsonl');

      await writeCodexJsonl(parentFilePath, [
        {
          timestamp: '2026-07-06T14:30:42.000Z',
          type: 'session_meta',
          payload: {
            id: 'parent-1',
            cwd: '/workspace/demo',
          },
        },
        {
          timestamp: '2026-07-06T14:30:42.142Z',
          type: 'response_item',
          payload: {
            type: 'function_call',
            name: 'spawn_agent',
            namespace: 'multi_agent_v1',
            call_id: 'call_spawn',
            arguments: JSON.stringify({
              agent_type: 'Ramanujan',
              message: 'banner-test\nCreate a todo list',
            }),
          },
        },
        {
          timestamp: '2026-07-06T14:30:43.000Z',
          type: 'response_item',
          payload: {
            type: 'function_call_output',
            call_id: 'call_spawn',
            output: JSON.stringify({ agent_id: 'child-1' }),
          },
        },
      ]);

      await writeCodexJsonl(childFilePath, [
        {
          timestamp: '2026-07-06T14:30:45.000Z',
          type: 'session_meta',
          payload: {
            id: 'child-1',
            cwd: '/workspace/demo',
            thread_source: 'subagent',
            parent_thread_id: 'parent-1',
          },
        },
        {
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
        },
        {
          timestamp: '2026-07-06T14:30:50.000Z',
          type: 'response_item',
          payload: {
            type: 'function_call_output',
            call_id: 'call_plan',
            output: 'Plan updated',
          },
        },
      ]);

      sessionsDb.createSession(
        'parent-1',
        'codex',
        '/workspace/demo',
        'Parent Session',
        undefined,
        undefined,
        parentFilePath,
      );

      const provider = new CodexSessionsProvider();
      const history = await provider.fetchHistory('parent-1', { providerSessionId: 'parent-1' });
      const taskRow = history.messages.find((message) => message.kind === 'tool_use' && message.toolName === 'Task');

      assert.ok(taskRow);
      assert.deepEqual(taskRow?.subagentTools, [
        {
          toolId: 'call_plan',
          toolName: 'TodoList',
          toolInput: {
            items: [
              { text: 'say hello', status: 'completed' },
              { text: 'say bye', status: 'in_progress' },
            ],
          },
          timestamp: '2026-07-06T14:30:49.657Z',
          toolResult: {
            content: 'Plan updated',
            isError: false,
          },
        },
      ]);
    } finally {
      restoreHomeDir();
      await rm(homeDir, { recursive: true, force: true });
    }
  });
});
