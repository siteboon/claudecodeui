import assert from 'node:assert/strict';

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, it, vi } from 'vitest';

import type { NormalizedMessage } from '@/shared/types';

/**
 * Live event-stream rows and persisted transcript rows derive their message
 * ids from different sources, so `serverIds.has(id)` never matches them. Text
 * and thinking alike are therefore matched by content echo — otherwise every
 * reasoning block renders twice once the persisted-tail refresh reconciles
 * realtime.
 *
 * The turn locating behind that prune keys off chronology, and live rows
 * (stamped when the client received them) and persisted rows (stamped when the
 * provider wrote them) can interleave enough to mislocate the turn. When the
 * prune misses, the duplicate copies still reach the merged view — woven
 * between each other's sibling rows rather than adjacent — so the merged-view
 * dedupe drops same-turn same-kind duplicates by turn scope, not by position.
 */

const sessionMessages = vi.fn();

vi.mock('@/shared/api', () => ({
  api: {
    providers: {
      sessionMessages: (...args: unknown[]) => sessionMessages(...args),
    },
  },
}));

const text = (id: string, role: 'user' | 'assistant', content: string, timestamp: string): NormalizedMessage => ({
  id,
  kind: 'text',
  role,
  provider: 'pi',
  sessionId: 'session-1',
  content,
  timestamp,
} as NormalizedMessage);

// Persisted and live thinking rows carry no role — matching is by content only.
const thinking = (id: string, content: string, timestamp: string): NormalizedMessage => ({
  id,
  kind: 'thinking',
  provider: 'pi',
  sessionId: 'session-1',
  content,
  timestamp,
} as NormalizedMessage);

const user = () => text('u1', 'user', 'first prompt', '2026-01-01T00:00:01.000Z');
const answer = () => text('a1', 'assistant', 'first answer', '2026-01-01T00:00:03.000Z');
const persistedThinking = () => thinking('p1', 'Let me reason about it.', '2026-01-01T00:00:02.000Z');

const page = (messages: NormalizedMessage[]) => sessionMessages.mockResolvedValue({
  ok: true,
  json: async () => ({ data: { messages, total: messages.length, hasMore: false } }),
});

beforeEach(() => {
  sessionMessages.mockReset();
});

afterEach(() => {
  vi.resetModules();
});

async function loadedStore() {
  const { useSessionStore } = await import('@/modules/chat/hooks/useSessionStore');
  return renderHook(() => useSessionStore());
}

describe('thinking echoes between live stream and persisted history', () => {
  it('drops a live thinking row once the persisted transcript holds the same block', async () => {
    page([user(), answer()]);
    const { result } = await loadedStore();
    await act(async () => {
      await result.current.fetchFromServer('session-1', { limit: 20, offset: 0 });
    });

    act(() => {
      result.current.appendRealtime(
        'session-1',
        thinking('live-t1', 'Let me reason about it.', '2026-01-01T00:00:04.000Z'),
      );
    });
    assert.equal(result.current.getMessages('session-1').length, 3);

    // The run finished and the JSONL now holds the block under its own id.
    page([user(), persistedThinking(), answer()]);
    await act(async () => {
      await result.current.refreshLatestFromServer('session-1');
    });

    assert.deepEqual(
      result.current.getMessages('session-1').map((message) => message.id),
      ['u1', 'p1', 'a1'],
    );
  });

  it('keeps a live thinking row the persisted turn does not repeat', async () => {
    page([user(), answer()]);
    const { result } = await loadedStore();
    await act(async () => {
      await result.current.fetchFromServer('session-1', { limit: 20, offset: 0 });
    });

    act(() => {
      result.current.appendRealtime(
        'session-1',
        thinking('live-t2', 'A different line of reasoning.', '2026-01-01T00:00:04.000Z'),
      );
    });

    page([user(), persistedThinking(), answer()]);
    await act(async () => {
      await result.current.refreshLatestFromServer('session-1');
    });

    assert.deepEqual(
      result.current.getMessages('session-1').map((message) => message.id),
      ['u1', 'p1', 'a1', 'live-t2'],
    );
  });

  it('collapses adjacent persisted and live thinking rows with identical content', async () => {
    page([user(), persistedThinking(), answer()]);
    const { result } = await loadedStore();
    await act(async () => {
      await result.current.fetchFromServer('session-1', { limit: 20, offset: 0 });
    });

    // Same block seen twice back-to-back in merged order, before any refresh
    // can reconcile realtime: only the content ties them together.
    act(() => {
      result.current.appendRealtime(
        'session-1',
        thinking('live-t1', 'Let me reason about it.', '2026-01-01T00:00:02.000Z'),
      );
    });

    assert.deepEqual(
      result.current.getMessages('session-1').map((message) => message.id),
      ['u1', 'p1', 'a1'],
    );
  });

  it('still drops a live assistant text row the persisted turn already holds', async () => {
    page([user(), answer()]);
    const { result } = await loadedStore();
    await act(async () => {
      await result.current.fetchFromServer('session-1', { limit: 20, offset: 0 });
    });

    act(() => {
      result.current.appendRealtime(
        'session-1',
        text('live-a1', 'assistant', 'first answer', '2026-01-01T00:00:04.000Z'),
      );
    });

    await act(async () => {
      await result.current.refreshLatestFromServer('session-1');
    });

    assert.deepEqual(
      result.current.getMessages('session-1').map((message) => message.id),
      ['u1', 'a1'],
    );
  });

  it('drops interleaved server/live echoes that never sort next to their twin', async () => {
    // The completion flash: live rows are stamped when the client received
    // them and persisted rows when the provider wrote them, so the timestamp
    // sort weaves each copy between the other side's sibling rows —
    // server text, live thinking, live text, server thinking — and no
    // duplicate pair is adjacent.
    page([
      user(),
      text('a1', 'assistant', 'first answer', '2026-01-01T00:00:03.000Z'),
      thinking('p1', 'Let me reason about it.', '2026-01-01T00:00:04.500Z'),
    ]);
    const { result } = await loadedStore();
    await act(async () => {
      await result.current.fetchFromServer('session-1', { limit: 20, offset: 0 });
    });

    act(() => {
      result.current.appendRealtime(
        'session-1',
        thinking('live-t1', 'Let me reason about it.', '2026-01-01T00:00:03.500Z'),
      );
      result.current.appendRealtime(
        'session-1',
        text('live-a1', 'assistant', 'first answer', '2026-01-01T00:00:04.000Z'),
      );
    });

    const merged = result.current.getMessages('session-1');
    assert.deepEqual(merged.map((message) => message.id), ['u1', 'a1', 'live-t1']);
    const echoedContents = merged
      .map((message) => `${message.kind}:${(message.content || '').trim()}`);
    assert.equal(new Set(echoedContents).size, echoedContents.length);
  });

  it('keeps identical replies that belong to different turns', async () => {
    page([
      user(),
      text('a1', 'assistant', 'same reply', '2026-01-01T00:00:03.000Z'),
      text('u2', 'user', 'second prompt', '2026-01-01T00:00:05.000Z'),
      text('a2', 'assistant', 'same reply', '2026-01-01T00:00:07.000Z'),
    ]);
    const { result } = await loadedStore();
    await act(async () => {
      await result.current.fetchFromServer('session-1', { limit: 20, offset: 0 });
    });

    // A user prompt starts a new echo scope: two turns answering with the
    // exact same words are two genuine replies, not a server/live double.
    assert.deepEqual(
      result.current.getMessages('session-1').map((message) => message.id),
      ['u1', 'a1', 'u2', 'a2'],
    );
  });
});
