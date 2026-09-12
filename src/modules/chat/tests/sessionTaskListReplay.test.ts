import assert from 'node:assert/strict';
import { test } from 'vitest';

import type { NormalizedMessage } from '@/shared/types';
import { buildSessionTaskLedger } from '@/modules/chat/utils/sessionTaskList';

// Fixture shape mirrors server/shared/tests/message-unification.test.ts so the
// replay rules stay checked against the same transcripts both sides read.

const message = (overrides: Partial<NormalizedMessage>): NormalizedMessage => ({
  id: `m-${Math.random().toString(36).slice(2)}`,
  sessionId: 's1',
  timestamp: '2026-09-12T00:00:00.000Z',
  provider: 'claude',
  kind: 'text',
  ...overrides,
} as NormalizedMessage);

const taskCall = (
  toolName: string,
  toolId: string,
  toolInput: unknown,
  toolUseResult: unknown,
): NormalizedMessage => message({
  kind: 'tool_use',
  toolName,
  toolId,
  toolInput,
  toolResult: { content: 'ok', isError: false, toolUseResult },
});

const todoSnapshot = (toolId: string, todos: unknown[]): NormalizedMessage => message({
  kind: 'tool_use',
  toolName: 'TodoWrite',
  toolId,
  toolInput: { todos },
});

test('the task tracker replays creates, an id-keyed update, and counts', () => {
  const ledger = buildSessionTaskLedger([
    taskCall('TaskCreate', 't1', { subject: 'Read notes', activeForm: 'Reading notes' }, { task: { id: '1' } }),
    taskCall('TaskCreate', 't2', { subject: 'Run tests', activeForm: 'Running tests' }, { task: { id: '2' } }),
    taskCall('TaskUpdate', 't3', { taskId: '1', status: 'completed' }, { success: true }),
  ]);

  assert.deepEqual(ledger.tasks.map((task) => [task.id, task.status]), [['1', 'completed'], ['2', 'pending']]);
  assert.equal(ledger.completed, 1);
  assert.equal(ledger.pending, 1);
  assert.equal(ledger.inProgress, 0);
});

test('a create whose result has not landed is keyed by the tool call id', () => {
  const ledger = buildSessionTaskLedger([
    message({ kind: 'tool_use', toolName: 'TaskCreate', toolId: 'pending-1', toolInput: { subject: 'Draft' } }),
  ]);

  assert.equal(ledger.tasks.length, 1);
  assert.equal(ledger.tasks[0].id, 'pending-1');
  assert.equal(ledger.tasks[0].content, 'Draft');
});

test('a TaskList restatement wins wholesale and keeps known activeForm', () => {
  const ledger = buildSessionTaskLedger([
    taskCall('TaskCreate', 't1', { subject: 'Read notes', activeForm: 'Reading notes' }, { task: { id: '1' } }),
    taskCall('TaskList', 't2', {}, { tasks: [
      { id: '1', subject: 'Read notes (edited)', status: 'in_progress' },
      { id: '2', subject: 'Extra', status: 'pending' },
    ] }),
  ]);

  assert.deepEqual(ledger.tasks.map((task) => [task.id, task.status]), [['1', 'in_progress'], ['2', 'pending']]);
  assert.equal(ledger.tasks[0].activeForm, 'Reading notes');
  assert.equal(ledger.inProgress, 1);
});

test('TodoWrite snapshots restate the whole ledger and the last one wins', () => {
  const ledger = buildSessionTaskLedger([
    todoSnapshot('w1', [{ content: 'One', status: 'pending' }, { content: 'Two', status: 'pending' }]),
    todoSnapshot('w2', [{ content: 'One', status: 'completed' }, { content: 'Two', status: 'in_progress' }]),
  ]);

  assert.deepEqual(ledger.tasks.map((task) => task.status), ['completed', 'in_progress']);
  assert.equal(ledger.total, 2);
});

test('repeated identical snapshots collapse and later creates own the ledger', () => {
  const ledger = buildSessionTaskLedger([
    todoSnapshot('w1', [{ content: 'Ship it', status: 'pending' }]),
    todoSnapshot('w2', [{ content: 'Ship it', status: 'pending' }]),
    todoSnapshot('w3', [{ content: 'Ship it', status: 'pending' }]),
    taskCall('TaskCreate', 't1', { subject: 'Follow-up' }, { task: { id: '9' } }),
  ]);

  // The tracker wrote last, so it owns the ledger regardless of the snapshots.
  assert.deepEqual(ledger.tasks.map((task) => task.id), ['9']);
});

test('whichever source wrote last owns the ledger', () => {
  const trackerThenSnapshot = buildSessionTaskLedger([
    taskCall('TaskCreate', 't1', { subject: 'Stale', activeForm: 'Staling' }, { task: { id: '1' } }),
    todoSnapshot('w1', [{ content: 'Fresh', status: 'in_progress' }]),
  ]);
  assert.deepEqual(trackerThenSnapshot.tasks.map((task) => task.content), ['Fresh']);

  const snapshotThenTracker = buildSessionTaskLedger([
    todoSnapshot('w1', [{ content: 'Fresh', status: 'in_progress' }]),
    taskCall('TaskCreate', 't1', { subject: 'Stale', activeForm: 'Staling' }, { task: { id: '1' } }),
  ]);
  assert.deepEqual(snapshotThenTracker.tasks.map((task) => task.content), ['Stale']);
});

test('subagent rows are kept out of the main ledger', () => {
  const ledger = buildSessionTaskLedger([
    taskCall('TaskCreate', 't1', { subject: 'Child work' }, { task: { id: '1' } }),
    message({
      kind: 'tool_use',
      toolName: 'TaskCreate',
      toolId: 't2',
      toolInput: { subject: 'Subagent private' },
      toolResult: { content: 'ok', isError: false, toolUseResult: { task: { id: '2' } } },
      parentToolUseId: 'toolu-parent-1',
    }),
    message({
      kind: 'tool_use',
      toolName: 'TodoWrite',
      toolId: 'w1',
      toolInput: { todos: [{ content: 'Child snapshot', status: 'pending' }] },
      parentToolUseId: 'toolu-parent-1',
    }),
  ]);

  assert.deepEqual(ledger.tasks.map((task) => task.content), ['Child work']);
});

test('non-ledger traffic and empty transcripts yield an empty ledger', () => {
  assert.equal(buildSessionTaskLedger([]).total, 0);
  assert.equal(buildSessionTaskLedger([
    message({ kind: 'text', role: 'assistant', content: 'hello' } as Partial<NormalizedMessage>),
    message({ kind: 'tool_use', toolName: 'Bash', toolId: 'b1', toolInput: { command: 'ls' } }),
  ]).total, 0);
});
