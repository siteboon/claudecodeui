/// <reference types="node" />

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  isServerBackedRealtimeMessage,
  mergeRealtimeMessages,
} from './sessionMessageDedupe';
import type { NormalizedMessage } from './useSessionStore';

function message(overrides: Partial<NormalizedMessage> = {}): NormalizedMessage {
  return {
    id: 'msg-1',
    sessionId: 'session-1',
    timestamp: '2026-06-15T12:00:00.000Z',
    provider: 'claude',
    kind: 'text',
    ...overrides,
  };
}

describe('session realtime message dedupe', () => {
  it('upserts duplicate realtime user rows by stable sequence identity', () => {
    const result = mergeRealtimeMessages({
      currentMessages: [],
      incomingMessages: [
        message({
          id: 'local-user-1',
          role: 'user',
          content: 'hello',
          sequence: 12,
        }),
        message({
          id: 'local-user-2',
          role: 'user',
          content: 'hello',
          sequence: 12,
          timestamp: '2026-06-15T12:00:01.000Z',
        }),
      ],
    });

    assert.equal(result.changed, true);
    assert.equal(result.messages.length, 1);
    assert.equal(result.messages[0].id, 'local-user-2');
  });

  it('upserts duplicate realtime Thinking rows by stable sequence identity', () => {
    const result = mergeRealtimeMessages({
      currentMessages: [],
      incomingMessages: [
        message({
          id: 'thinking-1',
          kind: 'thinking',
          text: 'Thinking...',
          sequence: 20,
        }),
        message({
          id: 'thinking-2',
          kind: 'thinking',
          text: 'Thinking...',
          sequence: 20,
          timestamp: '2026-06-15T12:00:01.000Z',
        }),
      ],
    });

    assert.equal(result.changed, true);
    assert.equal(result.messages.length, 1);
    assert.equal(result.messages[0].id, 'thinking-2');
  });

  it('upserts duplicate realtime Thinking rows without row or sequence identity', () => {
    const result = mergeRealtimeMessages({
      currentMessages: [],
      incomingMessages: [
        message({
          id: 'thinking-1',
          kind: 'thinking',
          text: 'Thinking...',
        }),
        message({
          id: 'thinking-2',
          kind: 'thinking',
          content: 'Thinking...',
          timestamp: '2026-06-15T12:00:01.000Z',
        }),
      ],
    });

    assert.equal(result.changed, true);
    assert.equal(result.messages.length, 1);
    assert.equal(result.messages[0].id, 'thinking-2');
  });

  it('keeps older same-text Thinking rows separate', () => {
    const result = mergeRealtimeMessages({
      currentMessages: [],
      incomingMessages: [
        message({
          id: 'thinking-1',
          kind: 'thinking',
          content: 'Thinking...',
        }),
        message({
          id: 'thinking-2',
          kind: 'thinking',
          content: 'Thinking...',
          timestamp: '2026-06-15T12:00:05.000Z',
        }),
      ],
    });

    assert.equal(result.changed, true);
    assert.equal(result.messages.length, 2);
    assert.deepEqual(result.messages.map(({ id }) => id), ['thinking-1', 'thinking-2']);
  });

  it('keeps Thinking rows with different sequence identities separate', () => {
    const result = mergeRealtimeMessages({
      currentMessages: [],
      incomingMessages: [
        message({
          id: 'thinking-1',
          kind: 'thinking',
          content: 'Thinking...',
          sequence: 20,
        }),
        message({
          id: 'thinking-2',
          kind: 'thinking',
          content: 'Thinking...',
          sequence: 21,
          timestamp: '2026-06-15T12:00:01.000Z',
        }),
      ],
    });

    assert.equal(result.changed, true);
    assert.equal(result.messages.length, 2);
    assert.deepEqual(result.messages.map(({ id }) => id), ['thinking-1', 'thinking-2']);
  });

  it('skips realtime messages already represented by server history', () => {
    const serverMessage = message({
      id: 'server-user-1',
      role: 'user',
      content: 'hello',
      sequence: 30,
    });
    const realtimeMessage = message({
      id: 'local-user-1',
      role: 'user',
      content: 'hello',
      sequence: 30,
    });

    const result = mergeRealtimeMessages({
      currentMessages: [],
      incomingMessages: [realtimeMessage],
      serverMessages: [serverMessage],
    });

    assert.equal(isServerBackedRealtimeMessage([serverMessage], realtimeMessage), true);
    assert.equal(result.changed, false);
    assert.deepEqual(result.messages, []);
  });

  it('keeps distinct tool and permission events separate without broad request matching', () => {
    const toolEvents = [
      message({
        id: 'tool-1',
        kind: 'tool_use',
        toolId: 'shared-tool',
        requestId: 'shared-request',
        toolName: 'Read',
      }),
      message({
        id: 'tool-2',
        kind: 'tool_use',
        toolId: 'shared-tool',
        requestId: 'shared-request',
        toolName: 'Read',
      }),
    ];
    const permissionEvents = [
      message({
        id: 'permission-1',
        kind: 'permission_request',
        requestId: 'shared-request',
        toolName: 'Bash',
      }),
      message({
        id: 'permission-2',
        kind: 'permission_request',
        requestId: 'shared-request',
        toolName: 'Bash',
      }),
    ];

    const result = mergeRealtimeMessages({
      currentMessages: [],
      incomingMessages: [...toolEvents, ...permissionEvents],
    });

    assert.equal(result.messages.length, 4);
    assert.deepEqual(result.messages.map(({ id }) => id), [
      'tool-1',
      'tool-2',
      'permission-1',
      'permission-2',
    ]);
  });

  it('does not let server-equivalent realtime messages evict pending buffer entries', () => {
    const currentMessages = Array.from({ length: 4 }, (_, index) =>
      message({
        id: `pending-${index}`,
        kind: 'text',
        role: 'assistant',
        content: `pending ${index}`,
        sequence: 100 + index,
      }),
    );
    const serverMessage = message({
      id: 'server-complete',
      role: 'assistant',
      content: 'done',
      sequence: 999,
    });
    const realtimeMessage = message({
      id: 'realtime-complete',
      role: 'assistant',
      content: 'done',
      sequence: 999,
    });

    const result = mergeRealtimeMessages({
      currentMessages,
      incomingMessages: [realtimeMessage],
      serverMessages: [serverMessage],
      maxMessages: 4,
    });

    assert.equal(result.changed, false);
    assert.equal(result.messages, currentMessages);
    assert.deepEqual(result.messages.map(({ id }) => id), [
      'pending-0',
      'pending-1',
      'pending-2',
      'pending-3',
    ]);
  });
});
