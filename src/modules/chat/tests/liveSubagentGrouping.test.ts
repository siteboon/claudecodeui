import assert from 'node:assert/strict';

import { test } from 'vitest';

import type { NormalizedMessage } from '@/shared/types';
import { normalizedToChatMessages } from '@/modules/chat/hooks/useChatMessages';

/**
 * While a subagent runs, its rows stream in stamped with the spawning Task's
 * tool id (`parentToolUseId`). They used to render as the session's own tool
 * calls, only to jump inside the subagent container after a refresh, when the
 * server ships the same timeline as `subagentTools` on the Task row.
 */

function message(
  id: string,
  overrides: Partial<NormalizedMessage>,
): NormalizedMessage {
  return {
    id,
    sessionId: 'session-1',
    timestamp: '2026-08-26T12:00:00.000Z',
    provider: 'claude',
    kind: 'text',
    role: 'assistant',
    content: id,
    ...overrides,
  };
}

const taskRow = () => message('task', {
  kind: 'tool_use',
  toolId: 'task-1',
  toolName: 'Task',
  toolInput: { description: 'demo', prompt: 'do things' },
});

const subagentBash = (id: string, toolId: string) => message(id, {
  kind: 'tool_use',
  toolId,
  toolName: 'Bash',
  toolInput: { command: `echo ${id}` },
  parentToolUseId: 'task-1',
});

test('live subagent rows fold into the container instead of rendering top-level', () => {
  const converted = normalizedToChatMessages([
    taskRow(),
    subagentBash('step-1', 'bash-1'),
    message('note', { parentToolUseId: 'task-1', content: 'Running step 2' }),
    subagentBash('step-2', 'bash-2'),
    message('result-1', {
      kind: 'tool_result',
      toolId: 'bash-1',
      content: 'step 1 done',
      parentToolUseId: 'task-1',
    }),
  ]);

  assert.equal(converted.length, 1, 'subagent rows must not render as top-level messages');
  const container = converted[0];
  assert.equal(container.isSubagentContainer, true);

  const activity = container.subagentActivity ?? [];
  assert.deepEqual(
    activity.map((entry) => entry.kind),
    ['tool', 'text', 'tool'],
  );
  assert.equal(activity[0].toolName, 'Bash');
  assert.equal(activity[0].toolResult?.content, 'step 1 done');
  assert.equal(activity[2].toolResult, undefined, 'unfinished tool must stay pending');
});

test('the echoed task prompt does not appear in the timeline', () => {
  const converted = normalizedToChatMessages([
    taskRow(),
    message('echo', { role: 'user', content: 'do things', parentToolUseId: 'task-1' }),
  ]);

  assert.equal(converted.length, 1);
  assert.equal(converted[0].subagentActivity, undefined);
});

test('a growing live timeline invalidates the cached container projection', () => {
  const task = taskRow();
  const first = subagentBash('step-1', 'bash-1');

  const initial = normalizedToChatMessages([task, first]);
  assert.equal(initial[0].subagentActivity?.length, 1);

  const updated = normalizedToChatMessages([task, first, subagentBash('step-2', 'bash-2')]);
  assert.equal(
    updated[0].subagentActivity?.length,
    2,
    'the container must pick up rows that arrived after it was cached',
  );
});

test('the longer of the live and server timelines wins', () => {
  const serverTimeline = [
    { kind: 'tool' as const, toolId: 'bash-1', toolName: 'Bash' },
    { kind: 'tool' as const, toolId: 'bash-2', toolName: 'Bash' },
  ];
  const taskWithServerTimeline = message('task', {
    kind: 'tool_use',
    toolId: 'task-1',
    toolName: 'Task',
    toolInput: {},
    subagentTools: serverTimeline,
  });

  const stale = normalizedToChatMessages([
    taskWithServerTimeline,
    subagentBash('step-1', 'bash-1'),
  ]);
  assert.equal(stale[0].subagentActivity, serverTimeline);

  const fresher = normalizedToChatMessages([
    taskWithServerTimeline,
    subagentBash('step-1', 'bash-1'),
    subagentBash('step-2', 'bash-2'),
    subagentBash('step-3', 'bash-3'),
  ]);
  assert.equal(fresher[0].subagentActivity?.length, 3);
});
