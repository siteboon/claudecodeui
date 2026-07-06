import assert from 'node:assert/strict';
import test from 'node:test';

import { deriveAgentTodoSummaries } from './agentTodoSummary';
import type { ChatMessage } from '../types/types';

test('latest Claude TodoWrite snapshot wins and counts todo statuses', () => {
  const messages: ChatMessage[] = [
    {
      type: 'assistant',
      timestamp: 1000,
      isToolUse: true,
      toolName: 'TodoWrite',
      toolInput: {
        todos: [
          { content: 'old done', status: 'completed' },
          { content: 'old active', status: 'in_progress' },
        ],
      },
    },
    {
      type: 'assistant',
      timestamp: 2000,
      isToolUse: true,
      toolName: 'TodoWrite',
      toolInput: {
        todos: [
          { content: 'write tests', status: 'completed' },
          { content: 'build utility', status: 'in_progress' },
          { content: 'wire UI later', status: 'pending' },
        ],
      },
    },
  ];

  const [summary] = deriveAgentTodoSummaries(messages);

  assert.equal(summary.id, 'agent');
  assert.equal(summary.label, 'Agent');
  assert.equal(summary.updatedAt.getTime(), 2000);
  assert.deepEqual(summary.todos.map((todo) => todo.content), [
    'write tests',
    'build utility',
    'wire UI later',
  ]);
  assert.equal(summary.activeTodo, 'build utility');
  assert.equal(summary.completedCount, 1);
  assert.equal(summary.pendingCount, 1);
  assert.equal(summary.inProgressCount, 1);
});

test('grouped Codex subagent TodoList snapshots show as subagent todos', () => {
  const summaries = deriveAgentTodoSummaries([
    {
      type: 'assistant',
      timestamp: 1000,
      isToolUse: true,
      toolName: 'Task',
      toolId: 'spawn-1',
      toolInput: { description: 'banner-test' },
      subagentState: {
        currentToolIndex: 0,
        isComplete: true,
        childTools: [
          {
            toolId: 'plan-1',
            toolName: 'TodoList',
            timestamp: new Date(2000),
            toolInput: {
              items: [
                { text: 'say hello', status: 'completed' },
                { text: 'say bye', status: 'completed' },
                { text: 'say thanks', status: 'completed' },
              ],
            },
          },
        ],
      },
    },
  ]);

  assert.equal(summaries.length, 1);
  assert.equal(summaries[0]?.label, 'banner-test');
  assert.equal(summaries[0]?.completedCount, 3);
  assert.deepEqual(summaries[0]?.todos.map((todo) => todo.content), [
    'say hello',
    'say bye',
    'say thanks',
  ]);
});

test('TodoRead parses JSON result content', () => {
  const messages: ChatMessage[] = [
    {
      type: 'assistant',
      timestamp: '2026-07-06T10:00:00.000Z',
      isToolUse: true,
      toolName: 'TodoRead',
      toolResult: {
        content: JSON.stringify([
          { content: 'read list', status: 'completed' },
          { title: 'next item', status: 'pending' },
        ]),
      },
    },
  ];

  const [summary] = deriveAgentTodoSummaries(messages);

  assert.deepEqual(summary.todos, [
    { content: 'read list', status: 'completed' },
    { content: 'next item', status: 'pending' },
  ]);
  assert.equal(summary.updatedAt.getTime(), Date.parse('2026-07-06T10:00:00.000Z'));
  assert.equal(summary.activeTodo, 'next item');
  assert.equal(summary.completedCount, 1);
  assert.equal(summary.pendingCount, 1);
});

test('Codex TodoList parses items with text and completed boolean', () => {
  const messages: ChatMessage[] = [
    {
      type: 'assistant',
      timestamp: 3000,
      isToolUse: true,
      toolName: 'TodoList',
      toolInput: {
        items: [
          { text: 'ported item', completed: true },
          { text: 'remaining item', completed: false },
        ],
      },
    },
  ];

  const [summary] = deriveAgentTodoSummaries(messages);

  assert.deepEqual(summary.todos, [
    { content: 'ported item', status: 'completed' },
    { content: 'remaining item', status: 'pending' },
  ]);
  assert.equal(summary.completedCount, 1);
  assert.equal(summary.pendingCount, 1);
  assert.equal(summary.inProgressCount, 0);
  assert.equal(summary.activeTodo, 'remaining item');
});

test('child todo tools produce subagent summaries keyed by the parent task message', () => {
  const messages: ChatMessage[] = [
    {
      type: 'assistant',
      timestamp: 4000,
      isToolUse: true,
      toolName: 'TodoWrite',
      toolInput: {
        todos: [{ content: 'main work', status: 'pending' }],
      },
    },
    {
      type: 'assistant',
      timestamp: 5000,
      isToolUse: true,
      toolName: 'Task',
      toolId: 'task-1',
      toolInput: { description: 'subagent work' },
      subagentState: {
        currentToolIndex: 0,
        isComplete: true,
        childTools: [
          {
            toolId: 'child-0',
            toolName: 'TodoList',
            timestamp: new Date(5500),
            toolInput: {
              todos: [{ content: 'old child work', status: 'pending' }],
            },
          },
          {
            toolId: 'child-1',
            toolName: 'TodoList',
            timestamp: new Date(6000),
            toolInput: {
              todos: [{ content: 'child work', status: 'in_progress' }],
            },
          },
        ],
      },
    },
  ];

  const summaries = deriveAgentTodoSummaries(messages);

  assert.deepEqual(summaries.map((summary) => summary.id), ['subagent:task-1', 'agent']);
  assert.equal(summaries[0].label, 'subagent work');
  assert.equal(summaries[0].activeTodo, 'child work');
  assert.equal(summaries[0].updatedAt.getTime(), 6000);
});
