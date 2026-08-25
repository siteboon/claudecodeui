import assert from 'node:assert/strict';
import test from 'node:test';

import { ClaudeSessionsProvider } from '@/modules/providers/list/claude/claude-sessions.provider.js';

const SESSION_ID = 'session-1';

const SKILL_BODY = [
  'Base directory for this skill: /tmp/claude/bundled-skills/2.1.220/abc123/claude-api',
  '',
  '# Building LLM-Powered Applications with Claude',
  '',
  'This skill helps you build LLM-powered applications with Claude.',
].join('\n');

test('claude: injected skill bodies are hidden even without the isMeta flag', () => {
  const provider = new ClaudeSessionsProvider();

  // The live SDK stream omits `isMeta`, so the payload has to be recognised by
  // its content or it renders as a giant user bubble mid-run.
  const live = provider.normalizeMessage(
    {
      uuid: 'u1',
      timestamp: '2026-07-28T10:00:00.000Z',
      message: { role: 'user', content: [{ type: 'text', text: SKILL_BODY }] },
    },
    SESSION_ID,
  );
  assert.deepEqual(live, []);

  const persisted = provider.normalizeMessage(
    {
      uuid: 'u2',
      timestamp: '2026-07-28T10:00:00.000Z',
      isMeta: true,
      message: { role: 'user', content: [{ type: 'text', text: SKILL_BODY }] },
    },
    SESSION_ID,
  );
  assert.deepEqual(persisted, []);
});

test('claude: the Skill tool result itself still reaches the UI', () => {
  const provider = new ClaudeSessionsProvider();

  const messages = provider.normalizeMessage(
    {
      uuid: 'u3',
      timestamp: '2026-07-28T10:00:00.000Z',
      message: {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'Launching skill: claude-api' }],
      },
    },
    SESSION_ID,
  );

  assert.equal(messages.length, 1);
  assert.equal(messages[0].kind, 'tool_result');
  assert.equal(messages[0].toolId, 'toolu_1');
});

test('claude: queue-operation remove with task-notification emits user-role text', () => {
  const provider = new ClaudeSessionsProvider();

  const notifications = provider.normalizeMessage(
    {
      uuid: 'qop-remove-1',
      timestamp: '2026-08-25T10:00:00.000Z',
      type: 'queue-operation',
      operation: 'remove',
      content: '<task-notification>\n<task-id>abc123</task-id>\n<status>completed</status>\n<summary>Agent finished</summary>\n</task-notification>',
    },
    SESSION_ID,
  );

  assert.equal(notifications.length, 1);
  assert.equal(notifications[0]?.kind, 'text');
  assert.equal(notifications[0]?.role, 'user');
  assert.equal(notifications[0]?.id, 'qop-remove-1');
  assert.ok(String(notifications[0]?.content ?? '').startsWith('<task-notification>'));
});

test('claude: queue-operation enqueue is ignored', () => {
  const provider = new ClaudeSessionsProvider();

  const notifications = provider.normalizeMessage(
    {
      uuid: 'qop-enq-1',
      timestamp: '2026-08-25T10:00:00.000Z',
      type: 'queue-operation',
      operation: 'enqueue',
      content: '<task-notification>\n<task-id>abc123</task-id>\n<status>completed</status>\n</task-notification>',
    },
    SESSION_ID,
  );

  assert.deepEqual(notifications, []);
});

test('claude: queue-operation dequeue without content is ignored', () => {
  const provider = new ClaudeSessionsProvider();

  const notifications = provider.normalizeMessage(
    {
      uuid: 'qop-deq-1',
      timestamp: '2026-08-25T10:00:00.000Z',
      type: 'queue-operation',
      operation: 'dequeue',
    },
    SESSION_ID,
  );

  assert.deepEqual(notifications, []);
});

test('claude: queue-operation remove without task-notification prefix is ignored', () => {
  const provider = new ClaudeSessionsProvider();

  const notifications = provider.normalizeMessage(
    {
      uuid: 'qop-other-1',
      timestamp: '2026-08-25T10:00:00.000Z',
      type: 'queue-operation',
      operation: 'remove',
      content: 'Some other queue content',
    },
    SESSION_ID,
  );

  assert.deepEqual(notifications, []);
});

test('claude: existing user-role task-notification from dequeue still works', () => {
  const provider = new ClaudeSessionsProvider();

  const notifications = provider.normalizeMessage(
    {
      uuid: 'u-deq-1',
      timestamp: '2026-08-25T10:00:00.000Z',
      message: {
        role: 'user',
        content: '<task-notification>\n<task-id>xyz789</task-id>\n<status>completed</status>\n<summary>Done</summary>\n</task-notification>',
      },
    },
    SESSION_ID,
  );

  // Already handled by the existing user-role text branch — just verify no
  // regression (it doesn't get caught by the queue-operation branch above).
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0]?.kind, 'text');
  assert.equal(notifications[0]?.role, 'user');
  assert.ok(String(notifications[0]?.content ?? '').startsWith('<task-notification>'));
});
