import assert from 'node:assert/strict';
import { act, renderHook } from '@testing-library/react';
import { test, vi } from 'vitest';
import { useChatRealtimeHandlers } from '@/modules/chat/hooks/useChatRealtimeHandlers';
import { useSessionStore } from '@/modules/chat/hooks/useSessionStore';
import type { ProjectSession, ServerEvent } from '@/shared/types';

for (const interleave of [false, true]) for (const flushed of [false, true]) test(`review-6 regression: foreign final preserves another reply buffer (flushed=${flushed}, interleave=${interleave})`, () => {
  vi.useFakeTimers();
  let listener!: (event: ServerEvent) => void;
  const idle = vi.fn();
  const hook = renderHook(() => {
    const store = useSessionStore();
    useChatRealtimeHandlers({ isActive: true, subscribe: fn => { listener = fn; return () => {}; },
      provider: 'claude', selectedSession: { id: 's' } as ProjectSession, currentSessionId: 's',
      setTokenBudget: () => {}, pendingPermissionRequests: [], setPendingPermissionRequests: () => {},
      lastSeqRef: { current: new Map() }, statusCheckSentAtRef: { current: new Map() },
      requestLatestMessages: async () => {}, sessionStore: store, onSessionIdle: idle,
    });
    return store;
  });
  const send = (event: Record<string, unknown>) => act(() => listener({ sessionId: 's', provider: 'claude', ...event } as unknown as ServerEvent));
  try {
    send({ kind: 'stream_delta', assistantReplyId: 'parent', assistantBlockIndex: 0, content: 'parent ' });
    if (flushed) act(() => vi.advanceTimersByTime(100));
    if (interleave) send({ kind: 'stream_delta', assistantReplyId: 'child', parentToolUseId: 'child-tool', assistantBlockIndex: 0, content: 'child ' });
    send({ id: 'child-final', kind: 'text', role: 'assistant', assistantReplyId: 'child', parentToolUseId: 'child-tool', content: 'child final' });
    act(() => vi.advanceTimersByTime(100));
    assert.ok(hook.result.current.getMessages('s').some(row => row.content === 'parent '));
    send({ kind: 'stream_delta', assistantReplyId: 'parent', assistantBlockIndex: 0, content: 'answer' });
    send({ id: 'parent-final', kind: 'text', role: 'assistant', assistantReplyId: 'parent', assistantBlockIndex: 0, content: 'parent answer' });
    act(() => vi.advanceTimersByTime(100));
    assert.deepEqual(hook.result.current.getMessages('s').map(row => row.content).sort(), ['child final', 'parent answer']);
    send({ id: 'later-final', kind: 'text', role: 'assistant', assistantReplyId: 'later-parent', content: 'parent answer' });
    assert.equal(hook.result.current.getMessages('s').length, 3, 'equal text from another native reply stays distinct');
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try { send({ kind: 'protocol_error', code: 'RUN_IN_PROGRESS', error: 'native turn is still running' }); }
    finally { error.mockRestore(); }
    assert.equal(idle.mock.calls.length, 0, 'refusing a second send cannot idle the native owner');
  } finally { hook.unmount(); vi.useRealTimers(); }
});
