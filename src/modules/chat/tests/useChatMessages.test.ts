import assert from 'node:assert/strict';

import { test } from 'vitest';

import type { NormalizedMessage } from '@/shared/types';
import { normalizedToChatMessages } from '@/modules/chat/hooks/useChatMessages';

function message(
  id: string,
  overrides: Partial<NormalizedMessage>,
): NormalizedMessage {
  return {
    id,
    sessionId: 'session-1',
    timestamp: '2026-08-19T12:00:00.000Z',
    provider: 'claude',
    kind: 'text',
    role: 'assistant',
    content: id,
    ...overrides,
  };
}

test('preserves historical UI message identity when only the stream record changes', () => {
  const first = message('first', { content: 'First answer' });
  const second = message('second', { content: 'Second answer' });
  const firstStream = message('stream', {
    kind: 'stream_delta',
    content: 'Part one',
  });

  const initial = normalizedToChatMessages([first, second, firstStream]);
  const nextStream = { ...firstStream, content: 'Part one and two' };
  const updated = normalizedToChatMessages([first, second, nextStream]);

  assert.notStrictEqual(updated, initial);
  assert.strictEqual(updated[0], initial[0]);
  assert.strictEqual(updated[1], initial[1]);
  assert.notStrictEqual(updated[2], initial[2]);
  assert.equal(updated[2]?.content, 'Part one and two');
});

test('rebuilds a tool-use UI message when its separately received result changes', () => {
  const toolUse = message('tool-use', {
    kind: 'tool_use',
    toolId: 'tool-1',
    toolName: 'Read',
    toolInput: { file_path: 'README.md' },
  });

  const withoutResult = normalizedToChatMessages([toolUse]);
  assert.equal(withoutResult[0]?.toolResult, null);

  const toolResult = message('tool-result', {
    kind: 'tool_result',
    toolId: 'tool-1',
    content: 'file contents',
  });
  const withResult = normalizedToChatMessages([toolUse, toolResult]);

  assert.equal(withResult.length, 1);
  assert.notStrictEqual(withResult[0], withoutResult[0]);
  assert.deepEqual(withResult[0]?.toolResult, {
    content: 'file contents',
    isError: false,
    toolUseResult: undefined,
  });

  const unrelatedStream = message('stream', {
    kind: 'stream_delta',
    content: 'Still working',
  });
  const afterUnrelatedUpdate = normalizedToChatMessages([
    toolUse,
    toolResult,
    unrelatedStream,
  ]);
  assert.strictEqual(afterUnrelatedUpdate[0], withResult[0]);

  const changedToolResult = {
    ...toolResult,
    content: 'updated file contents',
  };
  const afterResultChange = normalizedToChatMessages([
    toolUse,
    changedToolResult,
    unrelatedStream,
  ]);

  assert.notStrictEqual(afterResultChange[0], afterUnrelatedUpdate[0]);
  assert.strictEqual(afterResultChange[1], afterUnrelatedUpdate[1]);
  assert.equal(afterResultChange[0]?.toolResult?.content, 'updated file contents');
});

test('preserves existing UI objects when an older message is prepended', () => {
  const first = message('first', { content: 'First loaded message' });
  const second = message('second', { content: 'Second loaded message' });
  const initial = normalizedToChatMessages([first, second]);

  const older = message('older', {
    content: 'Older paginated message',
    timestamp: '2026-08-18T12:00:00.000Z',
  });
  const withOlderHistory = normalizedToChatMessages([older, first, second]);

  assert.strictEqual(withOlderHistory[1], initial[0]);
  assert.strictEqual(withOlderHistory[2], initial[1]);
});

test('preserves both UI objects produced by an unchanged task notification', () => {
  const notification = message('task-notification', {
    role: 'user',
    content: [
      '<task-notification>',
      '<status>completed</status>',
      '<summary>Background task finished</summary>',
      '<result>Detailed result</result>',
      '</task-notification>',
    ].join('\n'),
  });

  const initial = normalizedToChatMessages([notification]);
  assert.equal(initial.length, 2);

  const unrelated = message('unrelated', { content: 'A later message' });
  const updated = normalizedToChatMessages([notification, unrelated]);

  assert.strictEqual(updated[0], initial[0]);
  assert.strictEqual(updated[1], initial[1]);
  assert.equal(updated[0]?.isTaskNotification, true);
  assert.equal(updated[1]?.content, 'Detailed result');
});

test('folds the live task events of a background launch onto the tool row that launched it', () => {
  // The four `system` task subtypes the SDK emits for a running workflow,
  // normalized to `task_status` by the server. `updated` names only the task
  // id, so the row has to be found through the start event that paired it
  // with its tool call.
  const workflowCall = message('workflow-call', {
    kind: 'tool_use',
    toolId: 'toolu_workflow_1',
    toolName: 'Workflow',
    toolInput: { script: "export const meta = { name: 'audit' }", description: 'Audit the frontend' },
  });
  const started = message('task-started', {
    kind: 'task_status',
    event: 'started',
    taskId: 'wxkj4kcvd',
    toolUseId: 'toolu_workflow_1',
    taskType: 'local_workflow',
    workflowName: 'audit',
    description: 'Audit the frontend',
  });
  const progress = message('task-progress', {
    kind: 'task_status',
    event: 'progress',
    taskId: 'wxkj4kcvd',
    toolUseId: 'toolu_workflow_1',
    summary: 'Verify 3/6',
    usage: { totalTokens: 1_000, toolUses: 12, durationMs: 65_000 },
  });

  const running = normalizedToChatMessages([workflowCall, started, progress]);
  assert.equal(running.length, 1, 'task events are folded, never rendered on their own');
  assert.deepEqual(running[0]?.taskStatus, {
    status: 'running',
    taskId: 'wxkj4kcvd',
    taskType: 'local_workflow',
    workflowName: 'audit',
    description: 'Audit the frontend',
    summary: 'Verify 3/6',
    usage: { totalTokens: 1_000, toolUses: 12, durationMs: 65_000 },
  });

  // A newer event must rebuild the row's cached projection, or the card keeps
  // drawing the state it had when the row was first converted.
  const stopped = message('task-updated', {
    kind: 'task_status',
    event: 'updated',
    taskId: 'wxkj4kcvd',
    status: 'stopped',
  });
  const afterStop = normalizedToChatMessages([workflowCall, started, progress, stopped]);
  assert.notStrictEqual(afterStop[0], running[0]);
  assert.equal(afterStop[0]?.taskStatus?.status, 'stopped');
  assert.equal(afterStop[0]?.taskStatus?.summary, 'Verify 3/6', 'what earlier events said is kept');

  const finished = message('task-notification-live', {
    kind: 'task_status',
    event: 'notification',
    taskId: 'wxkj4kcvd',
    toolUseId: 'toolu_workflow_1',
    status: 'completed',
    summary: 'Dynamic workflow "audit" completed',
  });
  const afterFinish = normalizedToChatMessages([workflowCall, started, progress, finished]);
  assert.equal(afterFinish[0]?.taskStatus?.status, 'completed');
  assert.equal(afterFinish[0]?.taskStatus?.summary, 'Dynamic workflow "audit" completed');

  // Unchanged events leave the row's identity alone, like any other source.
  assert.strictEqual(normalizedToChatMessages([workflowCall, started, progress, finished])[0], afterFinish[0]);
});

test('keeps the last agent list a workflow\'s progress named through events that name none', () => {
  // A run's progress events report on its agents only once it has spawned
  // some, and later ones can carry an empty list; the card must keep drawing
  // the last list it was given rather than blanking between events.
  //
  // A fresh row per scenario: the projection cache keys a launch row on the
  // newest event folded onto it, which both scenarios below end on.
  const workflowCall = () => message('workflow-call', {
    kind: 'tool_use',
    toolId: 'toolu_workflow_1',
    toolName: 'Workflow',
    toolInput: { script: "export const meta = { name: 'audit' }" },
  });
  const agents = [
    { index: 0, label: 'audit:chat', agentId: 'aa1e064cf8bd159d6', state: 'done' as const },
    { index: 1, label: 'audit:sidebar', agentId: 'a9cfe29aa8f2afcbf', state: 'running' as const, lastToolName: 'Grep' },
  ];
  const withAgents = message('task-progress-1', {
    kind: 'task_status',
    event: 'progress',
    taskId: 'wxkj4kcvd',
    toolUseId: 'toolu_workflow_1',
    usage: { totalTokens: 1_000, toolUses: 12, durationMs: 65_000 },
    agents,
  });
  const withoutAgents = message('task-progress-2', {
    kind: 'task_status',
    event: 'progress',
    taskId: 'wxkj4kcvd',
    toolUseId: 'toolu_workflow_1',
    usage: { totalTokens: 1_200, toolUses: 14, durationMs: 70_000 },
    agents: [],
  });

  // Before any event names agents, the row carries none at all.
  const [early] = normalizedToChatMessages([workflowCall(), withoutAgents]);
  assert.equal('agents' in (early?.taskStatus ?? {}), false);

  const [row] = normalizedToChatMessages([workflowCall(), withAgents, withoutAgents]);
  assert.deepEqual(row?.taskStatus?.agents, agents);
  assert.equal(row?.taskStatus?.usage?.toolUses, 14, 'the rest of the newer event still lands');
});

test('an updated event finds a call launched before this page loaded through its acknowledgement', () => {
  // After a reload mid-run the `started` event that pairs task and call is
  // gone; the launch acknowledgement in history names the task, and a
  // `task_updated` — the only event that says a task was killed — names
  // nothing else.
  const workflowCall = message('workflow-call', {
    kind: 'tool_use',
    toolId: 'toolu_workflow_1',
    toolName: 'Workflow',
    toolInput: { script: "export const meta = { name: 'audit' }" },
  });
  const launchAck = message('workflow-ack', {
    kind: 'tool_result',
    toolId: 'toolu_workflow_1',
    content: 'Workflow launched in background. Task ID: wxkj4kcvd',
    toolUseResult: { status: 'async_launched', taskId: 'wxkj4kcvd', taskType: 'local_workflow', workflowName: 'audit' },
  });
  const killed = message('task-updated', {
    kind: 'task_status',
    event: 'updated',
    taskId: 'wxkj4kcvd',
    status: 'stopped',
  });

  const [row] = normalizedToChatMessages([workflowCall, launchAck, killed]);
  assert.equal(row?.taskStatus?.status, 'stopped');
});
