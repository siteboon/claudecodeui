import assert from 'node:assert/strict';

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, it, vi } from 'vitest';

import type { NormalizedMessage } from '@/shared/types';

/**
 * When an already-sent message is replaced, every client watching the session
 * drops the superseded turns before the replacement streams in — otherwise the
 * transcript shows the question twice until the next REST refresh.
 */

const sessionMessages = vi.fn();

vi.mock('@/shared/api', () => ({
  api: {
    providers: {
      sessionMessages: (...args: unknown[]) => sessionMessages(...args),
    },
  },
}));

const row = (id: string, content: string, anchor?: string): NormalizedMessage => ({
  id,
  kind: 'text',
  role: anchor ? 'user' : 'assistant',
  provider: 'claude',
  sessionId: 'session-1',
  content,
  timestamp: `2026-01-01T00:00:0${id}.000Z`,
  ...(anchor ? { transcriptAnchorId: anchor } : {}),
} as NormalizedMessage);

const HISTORY = [
  row('1', 'first prompt', 'u1'),
  row('2', 'first answer'),
  row('3', 'second prompt', 'u2'),
  row('4', 'second answer'),
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

describe('truncateAt', () => {
  it('drops the anchored message and everything after it', async () => {
    const { result } = await loadedStore();

    act(() => {
      result.current.truncateAt('session-1', 'u2');
    });

    assert.deepEqual(
      result.current.getMessages('session-1').map((message) => message.content),
      ['first prompt', 'first answer'],
    );
  });

  it('keeps a message whose anchor was not the cut point', async () => {
    const { result } = await loadedStore();

    act(() => {
      result.current.truncateAt('session-1', 'u1');
    });

    assert.deepEqual(result.current.getMessages('session-1'), []);
  });

  it('leaves the transcript alone for an anchor it does not hold', async () => {
    const { result } = await loadedStore();

    act(() => {
      result.current.truncateAt('session-1', 'not-here');
    });

    assert.equal(result.current.getMessages('session-1').length, 4);
  });

  it('clears rows that streamed for the turn being replaced', async () => {
    const { result } = await loadedStore();

    act(() => {
      result.current.appendRealtime('session-1', row('5', 'streaming reply'));
    });
    assert.equal(result.current.getMessages('session-1').length, 5);

    act(() => {
      result.current.truncateAt('session-1', 'u2');
    });

    assert.deepEqual(
      result.current.getMessages('session-1').map((message) => message.content),
      ['first prompt', 'first answer'],
    );
  });

  it('keeps the replacement the cut was made for', async () => {
    const { result } = await loadedStore();

    // The composer appends its echo of the edited message before the server
    // acknowledges the edit, so the cut arrives with the replacement already
    // on screen. Clearing it left the chat pane without the message the user
    // had just sent until the run finished.
    act(() => {
      result.current.appendRealtime('session-1', {
        ...row('5', 'second prompt, corrected'),
        role: 'user',
        replacesAnchorId: 'u2',
      } as NormalizedMessage);
    });

    act(() => {
      result.current.truncateAt('session-1', 'u2');
    });

    assert.deepEqual(
      result.current.getMessages('session-1').map((message) => message.content),
      ['first prompt', 'first answer', 'second prompt, corrected'],
    );
  });

  it('keeps the replacement last when the kept history comes back re-stamped', async () => {
    const { result } = await loadedStore();

    act(() => {
      result.current.appendRealtime('session-1', {
        ...row('5', 'second prompt, corrected'),
        role: 'user',
        replacesAnchorId: 'u2',
      } as NormalizedMessage);
      result.current.truncateAt('session-1', 'u2');
    });

    // A provider that rewinds by branching writes the surviving turns into a
    // fresh transcript, so the next refresh returns them stamped later than
    // the replacement was typed. Without a floor on where a replacement can
    // sort, the message the user just sent moves to the top.
    sessionMessages.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          messages: [
            { ...row('1', 'first prompt', 'u1'), timestamp: '2026-01-01T00:00:09.000Z' },
            { ...row('2', 'first answer'), timestamp: '2026-01-01T00:00:09.001Z' },
          ],
          total: 2,
          hasMore: false,
        },
      }),
    });

    await act(async () => {
      await result.current.refreshLatestFromServer('session-1');
    });

    assert.deepEqual(
      result.current.getMessages('session-1').map((message) => message.content),
      ['first prompt', 'first answer', 'second prompt, corrected'],
    );
  });

  it('keeps only the newest replacement when an earlier attempt was refused', async () => {
    const { result } = await loadedStore();

    // A refused send leaves its echo in place — nothing rolls it back — so by
    // the time an edit succeeds the store can be holding two attempts at the
    // same message.
    act(() => {
      result.current.appendRealtime('session-1', {
        ...row('5', 'first attempt'),
        role: 'user',
        replacesAnchorId: 'u2',
      } as NormalizedMessage);
      result.current.appendRealtime('session-1', {
        ...row('6', 'second attempt'),
        role: 'user',
        replacesAnchorId: 'u2',
      } as NormalizedMessage);
      result.current.truncateAt('session-1', 'u2');
    });

    assert.deepEqual(
      result.current.getMessages('session-1').map((message) => message.content),
      ['first prompt', 'first answer', 'second attempt'],
    );
  });

  it('clears a replacement tagged for a different cut', async () => {
    const { result } = await loadedStore();

    act(() => {
      result.current.appendRealtime('session-1', {
        ...row('5', 'first prompt, corrected'),
        role: 'user',
        replacesAnchorId: 'u1',
      } as NormalizedMessage);
    });

    act(() => {
      result.current.truncateAt('session-1', 'u2');
    });

    assert.deepEqual(
      result.current.getMessages('session-1').map((message) => message.content),
      ['first prompt', 'first answer'],
    );
  });
});
