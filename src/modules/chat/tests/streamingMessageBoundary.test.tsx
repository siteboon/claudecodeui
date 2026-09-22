import assert from 'node:assert/strict';

import { useRef } from 'react';

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, it, vi } from 'vitest';

import { useChatRealtimeHandlers } from '@/modules/chat/hooks/useChatRealtimeHandlers';
import { useSessionStore } from '@/modules/chat/hooks/useSessionStore';
import type { NormalizedMessage, ProjectSession, ServerEvent } from '@/shared/types';

/**
 * A provider whose live stream mixes `stream_delta` with ordinary rows —
 * OpenCode emits `tool_use`/`thinking` between text parts, Cursor never emits
 * `stream_end` at all — used to have every assistant message of the turn
 * accumulate into the one row parked at `__streaming_<sessionId>`, so the
 * replies merged into a single bubble sitting before the tool card that split
 * them. These drive the real handler against the real store.
 */

const VIEWED = 'viewed-session';

const event = (fields: Record<string, unknown>, sessionId = VIEWED): ServerEvent => ({
  id: `event-${Math.random()}`,
  sessionId,
  provider: 'opencode',
  timestamp: '2026-08-21T10:32:10.000Z',
  ...fields,
} as unknown as ServerEvent);

const renderChat = () => {
  let listener: ((message: ServerEvent) => void) | null = null;

  const view = renderHook(() => {
    const sessionStore = useSessionStore();
    // The refs ChatInterface owns and hands to the handler, held across
    // renders exactly as it holds them.
    const streamTimersRef = useRef(new Map<string, number>());
    const accumulatedStreamsRef = useRef(new Map<string, string>());
    const lastSeqRef = useRef(new Map<string, number>());
    const statusCheckSentAtRef = useRef(new Map<string, number>());

    useChatRealtimeHandlers({
      isActive: true,
      subscribe: (fn) => {
        listener = fn;
        return () => { listener = null; };
      },
      provider: 'opencode',
      selectedSession: { id: VIEWED } as ProjectSession,
      currentSessionId: VIEWED,
      setTokenBudget: () => {},
      pendingPermissionRequests: [],
      setPendingPermissionRequests: () => {},
      streamTimersRef,
      accumulatedStreamsRef,
      lastSeqRef,
      statusCheckSentAtRef,
      requestLatestMessages: async () => {},
      sessionStore,
    });

    return sessionStore;
  });

  act(() => {
    view.result.current.setActiveSession(VIEWED);
  });

  const dispatch = (...events: ServerEvent[]) => {
    act(() => {
      for (const item of events) listener?.(item);
      vi.advanceTimersByTime(200);
    });
  };

  const rows = (sessionId = VIEWED) => view.result.current
    .getMessages(sessionId)
    .map((message: NormalizedMessage) => `${message.kind}:${message.content ?? message.toolName ?? ''}`);

  return { dispatch, rows };
};

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('streamed message boundaries', () => {
  it('keeps the replies around a tool call in separate rows', () => {
    const { dispatch, rows } = renderChat();

    dispatch(
      event({ kind: 'stream_delta', content: 'Let me check ' }),
      event({ kind: 'stream_delta', content: 'the file.' }),
    );
    dispatch(event({ kind: 'tool_use', toolName: 'Read', toolId: 'call-1' }));
    dispatch(
      event({ kind: 'stream_delta', content: 'Found ' }),
      event({ kind: 'stream_delta', content: 'it.' }),
    );
    dispatch(event({ kind: 'complete', success: true }));

    assert.deepEqual(rows(), [
      'text:Let me check the file.',
      'tool_use:Read',
      'text:Found it.',
    ]);
  });

  it('keeps each live session\'s text in its own row', () => {
    const { dispatch, rows } = renderChat();

    dispatch(
      event({ kind: 'stream_delta', content: 'viewed ' }),
      event({ kind: 'stream_delta', content: 'background ' }, 'other-session'),
      event({ kind: 'stream_delta', content: 'reply' }),
      event({ kind: 'stream_delta', content: 'reply' }, 'other-session'),
    );
    dispatch(event({ kind: 'complete', success: true }));
    dispatch(event({ kind: 'complete', success: true }, 'other-session'));

    assert.deepEqual(rows(), ['text:viewed reply']);
    assert.deepEqual(rows('other-session'), ['text:background reply']);
  });

  it('leaves a provider that closes its own messages unchanged', () => {
    const { dispatch, rows } = renderChat();

    dispatch(
      event({ kind: 'stream_delta', content: 'streamed ' }),
      event({ kind: 'stream_delta', content: 'reply' }),
      event({ kind: 'stream_end' }),
    );
    dispatch(event({ kind: 'tool_use', toolName: 'Read', toolId: 'call-1' }));
    dispatch(event({ kind: 'text', role: 'assistant', content: 'whole reply' }));
    dispatch(event({ kind: 'complete', success: true }));

    assert.deepEqual(rows(), [
      'text:streamed reply',
      'tool_use:Read',
      'text:whole reply',
    ]);
  });
});
