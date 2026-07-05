import assert from 'node:assert/strict';
import test from 'node:test';

import type { NormalizedMessage } from '../../../stores/useSessionStore';

import { normalizedToChatMessages } from './useChatMessages';

function textMessage(content: string): NormalizedMessage {
  return {
    id: 'message-1',
    sessionId: 'session-1',
    timestamp: '2026-07-05T00:00:00.000Z',
    provider: 'claude',
    kind: 'text',
    role: 'user',
    content,
  };
}

test('task notifications render when tags contain whitespace and a different field order', () => {
  const messages = normalizedToChatMessages([
    textMessage(`
      <task-notification>
        <summary>Background indexing finished</summary>
        <status>completed</status>
        <output-file>logs/task.txt</output-file>
        <task-id>task-123</task-id>
      </task-notification>
    `),
  ]);

  assert.equal(messages.length, 1);
  assert.equal(messages[0]?.type, 'assistant');
  assert.equal(messages[0]?.isTaskNotification, true);
  assert.equal(messages[0]?.taskStatus, 'completed');
  assert.equal(messages[0]?.content, 'Background indexing finished');
});

test('tool results with missing content do not crash message normalization', () => {
  const messages = normalizedToChatMessages([
    {
      id: 'tool-result-1',
      sessionId: 'session-1',
      timestamp: '2026-07-05T00:00:00.000Z',
      provider: 'claude',
      kind: 'tool_result',
      content: undefined,
    },
  ]);

  assert.deepEqual(messages, []);
});
