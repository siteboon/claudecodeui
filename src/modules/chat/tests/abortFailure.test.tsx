import assert from 'node:assert/strict';
import { renderHook } from '@testing-library/react';
import { test } from 'vitest';

import { useChatRealtimeHandlers } from '@/modules/chat/hooks/useChatRealtimeHandlers';
import type { SessionStore } from '@/modules/chat/hooks/useSessionStore';
import type { ServerEvent } from '@/shared/types';

for (const code of ['ABORT_FAILED', 'RUN_IN_PROGRESS', 'SESSION_NOT_FOUND']) {
  test(`${code} preserves the stop button only when a run is still active`, () => {
    let dispatch: (event: ServerEvent) => void = () => {};
    const idle: Array<string | null | undefined> = [];
    const errors: unknown[] = [];
    const hook = renderHook(() => useChatRealtimeHandlers({
      isActive: true,
      subscribe: (listener) => { dispatch = listener; return () => {}; },
      provider: 'codex',
      selectedSession: null,
      currentSessionId: 'session',
      setTokenBudget() {},
      pendingPermissionRequests: [],
      setPendingPermissionRequests() {},
      streamTimerRef: { current: null },
      accumulatedStreamRef: { current: '' },
      lastSeqRef: { current: new Map() },
      statusCheckSentAtRef: { current: new Map() },
      onSessionIdle: (sessionId) => { idle.push(sessionId); },
      requestLatestMessages: async () => {},
      sessionStore: { appendRealtime: (_sessionId, message) => { errors.push(message); } } as SessionStore,
    }));
    dispatch({ kind: 'protocol_error', sessionId: 'session', code, error: 'Request failed' } as ServerEvent);
    assert.equal(errors.length, 1);
    assert.deepEqual(idle, code === 'SESSION_NOT_FOUND' ? ['session'] : []);
    hook.unmount();
  });
}
