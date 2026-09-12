import assert from 'node:assert/strict';

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, it, vi } from 'vitest';

import type { NormalizedMessage } from '@/shared/types';

/**
 * Live reasoning has to appear token-by-token, so the store keeps a
 * well-known thinking row that updateStreamingThinking replaces in place, and
 * finalizeStreamingThinking freezes it into a regular `thinking` row — the
 * same contract the text stream pair already honors.
 */

const sessionMessages = vi.fn();

vi.mock('@/shared/api', () => ({
  api: {
    providers: {
      sessionMessages: (...args: unknown[]) => sessionMessages(...args),
    },
  },
}));

const row = (id: string, content: string, kind: NormalizedMessage['kind'] = 'text'): NormalizedMessage => ({
  id,
  kind,
  role: kind === 'text' ? (id.startsWith('u') ? 'user' : 'assistant') : undefined,
  provider: 'claude',
  sessionId: 'session-1',
  content,
  timestamp: '2026-01-01T00:00:00.000Z',
} as NormalizedMessage);

const HISTORY = [
  row('u1', 'first prompt'),
  row('a1', 'first answer'),
];

beforeEach(() => {
  sessionMessages.mockReset();
  sessionMessages.mockResolvedValue({
    ok: true,
    json: async () => ({ data: { messages: HISTORY, total: HISTORY.length, hasMore: false } }),
  });
});

afterEach(() => {
  vi.resetModules();
});

async function loadedStore() {
  const { useSessionStore } = await import('@/modules/chat/hooks/useSessionStore');
  const view = renderHook(() => useSessionStore());
  await act(async () => {
    await view.result.current.fetchFromServer('session-1', { limit: 20, offset: 0 });
  });
  return view;
}

describe('thinking streaming', () => {
  it('replaces the same accumulated row instead of appending one per tick', async () => {
    const { result } = await loadedStore();

    act(() => {
      result.current.updateStreamingThinking('session-1', '想', 'claude');
    });
    act(() => {
      result.current.updateStreamingThinking('session-1', '想一想', 'claude');
    });

    const streamed = result.current.getMessages('session-1').filter(
      (message) => message.kind === 'thinking_delta',
    );
    assert.equal(streamed.length, 1);
    assert.equal(streamed[0]?.content, '想一想');
  });

  it('keeps thinking and text streams as separate rows', async () => {
    const { result } = await loadedStore();

    act(() => {
      result.current.updateStreamingThinking('session-1', 'thinking text', 'claude');
      result.current.updateStreaming('session-1', 'answer text', 'claude');
    });

    const messages = result.current.getMessages('session-1');
    const thinkingRow = messages.find((message) => message.kind === 'thinking_delta');
    const textRow = messages.find((message) => message.kind === 'stream_delta');
    assert.equal(thinkingRow?.content, 'thinking text');
    assert.equal(textRow?.content, 'answer text');
  });

  it('finalizes the thinking row into a regular thinking message', async () => {
    const { result } = await loadedStore();

    act(() => {
      result.current.updateStreamingThinking('session-1', 'final thought', 'claude');
      result.current.finalizeStreamingThinking('session-1');
    });

    const messages = result.current.getMessages('session-1');
    assert.equal(messages.some((message) => message.kind === 'thinking_delta'), false);
    const finished = messages.find((message) => message.kind === 'thinking');
    assert.equal(finished?.content, 'final thought');
  });

  it('prunes the finalized thinking row once the server transcript carries it', async () => {
    const { result } = await loadedStore();

    act(() => {
      result.current.updateStreamingThinking('session-1', 'final thought', 'claude');
      result.current.finalizeStreamingThinking('session-1');
    });
    assert.equal(result.current.getMessages('session-1').some((m) => m.kind === 'thinking'), true);

    // Simulate the complete-triggered refresh bringing the same reasoning back
    // from the persisted transcript under fresh ids.
    sessionMessages.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: {
          messages: [
            ...HISTORY,
            row('srv_think', 'final thought', 'thinking'),
          ],
          total: HISTORY.length + 1,
          hasMore: false,
        },
      }),
    });
    await act(async () => {
      await result.current.refreshLatestFromServer('session-1', { limit: 20 });
    });

    const thinkingRows = result.current.getMessages('session-1').filter(
      (message) => message.kind === 'thinking',
    );
    assert.equal(thinkingRows.length, 1);
    assert.equal(thinkingRows[0]?.id, 'srv_think');
  });
});

describe('appendRealtime same-id updates', () => {
  it('replaces an existing row instead of stacking a duplicate', async () => {
    const { result } = await loadedStore();

    act(() => {
      result.current.appendRealtime('session-1', row('item_1', 'partial reasoning', 'thinking'));
    });
    act(() => {
      result.current.appendRealtime('session-1', row('item_1', 'fuller reasoning', 'thinking'));
    });

    const rows = result.current.getMessages('session-1').filter(
      (message) => message.id === 'item_1',
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.content, 'fuller reasoning');
  });
});
