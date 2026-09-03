/**
 * Turn-level echo dedupe tests for the session message store.
 *
 * Guards `isAssistantTextEchoedInSameTurnOnServer` — the reconciliation
 * predicate that decides whether a finalized streaming row (a synthetic
 * assistant text built from live deltas) must be dropped because the
 * persisted transcript already carries the same reply in the same user turn.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { isAssistantTextEchoedInSameTurnOnServer } from './sessionMessageTurnDedupe';
import type { NormalizedMessage } from './useSessionStore';

const sessionId = 'session-1';

function msg(
  kind: NormalizedMessage['kind'],
  role: 'user' | 'assistant' | undefined,
  content: string,
  timestamp: string,
): NormalizedMessage {
  return {
    id: `${kind}-${role}-${timestamp}`,
    sessionId,
    timestamp,
    provider: 'antigravity',
    kind,
    role,
    content,
  };
}

function toolUse(timestamp: string): NormalizedMessage {
  return {
    id: `tool-${timestamp}`,
    sessionId,
    timestamp,
    provider: 'antigravity',
    kind: 'tool_use',
    toolName: 'shell',
    toolId: `tool_1`,
  };
}

test('a finalized row matching one persisted segment verbatim is an echo', () => {
  const server = [
    msg('text', 'user', 'hello', '2026-01-01T00:00:01Z'),
    msg('text', 'assistant', 'First segment.', '2026-01-01T00:00:02Z'),
  ];
  const realtime = [
    msg('text', 'assistant', 'First segment.', '2026-01-01T00:00:03Z'),
  ];

  assert.equal(isAssistantTextEchoedInSameTurnOnServer(realtime[0], server, realtime), true);
});

test('a concatenated bubble over a multi-segment turn is an echo', () => {
  // The persisted shape of one antigravity turn: text, tool, text.
  const server = [
    msg('text', 'user', 'hello', '2026-01-01T00:00:01Z'),
    msg('text', 'assistant', 'First segment.\n\n', '2026-01-01T00:00:02Z'),
    toolUse('2026-01-01T00:00:03Z'),
    msg('text', 'assistant', 'Second segment.', '2026-01-01T00:00:04Z'),
  ];
  // The live shape of the same turn: one bubble holding both segments
  // concatenated (inter-segment whitespace preserved by the delta stream).
  const realtime = [
    msg('text', 'assistant', 'First segment.\n\nSecond segment.', '2026-01-01T00:00:05Z'),
  ];

  assert.equal(isAssistantTextEchoedInSameTurnOnServer(realtime[0], server, realtime), true);
});

test('text equal to a different turn segment is not an echo', () => {
  const server = [
    msg('text', 'user', 'first turn', '2026-01-01T00:00:01Z'),
    msg('text', 'assistant', 'repeated answer', '2026-01-01T00:00:02Z'),
    msg('text', 'user', 'second turn', '2026-01-01T00:00:03Z'),
  ];
  const realtime = [
    msg('text', 'user', 'second turn', '2026-01-01T00:00:04Z'),
    msg('text', 'assistant', 'repeated answer', '2026-01-01T00:00:05Z'),
  ];

  assert.equal(isAssistantTextEchoedInSameTurnOnServer(realtime[1], server, realtime), false);
});

test('a bubble that differs from the persisted turn is kept', () => {
  const server = [
    msg('text', 'user', 'hello', '2026-01-01T00:00:01Z'),
    msg('text', 'assistant', 'Server answer', '2026-01-01T00:00:02Z'),
  ];
  const realtime = [
    msg('text', 'assistant', 'A different live answer', '2026-01-01T00:00:03Z'),
  ];

  assert.equal(isAssistantTextEchoedInSameTurnOnServer(realtime[0], server, realtime), false);
});

test('empty content is never an echo', () => {
  const server = [
    msg('text', 'user', 'hello', '2026-01-01T00:00:01Z'),
    msg('text', 'assistant', 'answer', '2026-01-01T00:00:02Z'),
  ];
  const realtime = [
    msg('text', 'assistant', '   ', '2026-01-01T00:00:03Z'),
  ];

  assert.equal(isAssistantTextEchoedInSameTurnOnServer(realtime[0], server, realtime), false);
});

test('a bubble with no matching user turn on the server is kept', () => {
  const server: NormalizedMessage[] = [];
  const realtime = [
    msg('text', 'assistant', 'orphan bubble', '2026-01-01T00:00:03Z'),
  ];

  assert.equal(isAssistantTextEchoedInSameTurnOnServer(realtime[0], server, realtime), false);
});

test('a finalized row is recognised as echo even when older user turns are paginated away', () => {
  // Server only carries the latest page (1 user message from turn 3)
  const server = [
    msg('text', 'user', 'third turn prompt', '2026-01-01T00:00:20Z'),
    msg('text', 'assistant', 'third turn reply', '2026-01-01T00:00:21Z'),
  ];
  // Realtime or client session store contains earlier turns and redundant user message
  const realtime = [
    msg('text', 'user', 'first turn prompt', '2026-01-01T00:00:01Z'),
    msg('text', 'user', 'second turn prompt', '2026-01-01T00:00:10Z'),
    msg('text', 'user', 'third turn prompt', '2026-01-01T00:00:20Z'),
    msg('text', 'assistant', 'third turn reply', '2026-01-01T00:00:22Z'),
  ];

  assert.equal(isAssistantTextEchoedInSameTurnOnServer(realtime[3], server, realtime), true);
});

test('a finalized row is recognised as echo when all user turns are paginated away by tool calls', () => {
  // Server only carries tool calls and the assistant reply (user message was 40 tool calls ago)
  const server = [
    msg('tool_use', undefined, '', '2026-01-01T00:00:20Z'),
    msg('text', 'assistant', 'long detailed summary of accomplished work', '2026-01-01T00:00:25Z'),
  ];
  const realtime = [
    msg('text', 'user', 'prompt that triggered tools', '2026-01-01T00:00:01Z'),
    msg('tool_use', undefined, '', '2026-01-01T00:00:10Z'),
    msg('text', 'assistant', 'long detailed summary of accomplished work', '2026-01-01T00:00:24Z'),
  ];

  assert.equal(isAssistantTextEchoedInSameTurnOnServer(realtime[2], server, realtime), true);
});

test('a finalized row is recognised as echo when streaming loses whitespace at token boundaries', () => {
  const server = [
    msg('text', 'user', '提交代码和push', '2026-01-01T00:00:01Z'),
    msg('text', 'assistant', '提交并推送完成 ✅\n\n两个 commit：\n1. **`35b663e`** — `fix: improve app robustness and auth error handling`', '2026-01-01T00:00:05Z'),
  ];
  const realtime = [
    msg('text', 'user', '提交代码和push', '2026-01-01T00:00:01Z'),
    // Streaming delta boundary dropped a space: "app robustness" -> "approbustness"
    msg('text', 'assistant', '提交并推送完成 ✅\n\n两个 commit：\n1. **`35b663e`** — `fix: improve approbustness and auth error handling`', '2026-01-01T00:00:06Z'),
  ];

  assert.equal(isAssistantTextEchoedInSameTurnOnServer(realtime[1], server, realtime), true);
});
