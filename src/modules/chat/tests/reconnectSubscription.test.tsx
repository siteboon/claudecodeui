import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import { useChatSessionState } from '@/modules/chat/hooks/useChatSessionState';
import type { Project, ProjectSession } from '@/shared/types';

vi.mock('@/shared/api', () => ({
  api: {
    providers: {
      sessionTokenUsage: () => Promise.resolve({ ok: false, json: async () => ({}) }),
    },
  },
}));

const SESSION_ID = 'session-a';
const project: Project = {
  projectId: 'project-1',
  path: '/repo',
  fullPath: '/repo',
  displayName: 'Repo',
  isStarred: false,
};
const session = { id: SESSION_ID } as ProjectSession;

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('requestAnimationFrame', () => 0);
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

test('one owner subscribes before the reconnect history refresh', async () => {
  const events: string[] = [];
  const sendMessage = vi.fn((message: unknown) => {
    events.push('subscribe');
    return message;
  });
  const refreshLatestFromServer = vi.fn(async () => {
    events.push('refresh');
    return {
      slot: { fetchedAt: 1, status: 'idle', total: 0, hasMore: false, offset: 0 },
      applied: true,
      changed: false,
      deferred: false,
    };
  });
  const sessionStore = {
    fetchFromServer: vi.fn(async () => ({
      fetchedAt: 1,
      status: 'idle',
      total: 0,
      hasMore: false,
      offset: 0,
    })),
    fetchMore: vi.fn(),
    appendRealtime: vi.fn(),
    refreshLatestFromServer,
    setActiveSession: vi.fn(),
    isStale: vi.fn(() => false),
    updateStreaming: vi.fn(),
    finalizeStreaming: vi.fn(),
    getMessages: vi.fn(() => []),
    getSessionSlot: vi.fn(() => ({
      fetchedAt: 1,
      status: 'idle',
      total: 0,
      hasMore: false,
      offset: 0,
    })),
  };
  const statusCheckSentAtRef = { current: new Map<string, number>() };
  const lastSeqRef = { current: new Map([[SESSION_ID, 41]]) };
  const firstSocket = {} as WebSocket;
  const replacementSocket = {} as WebSocket;

  const { rerender } = renderHook(
    ({ ws }: { ws: WebSocket }) => useChatSessionState({
      isActive: true,
      selectedProject: project,
      selectedSession: session,
      ws,
      sendMessage,
      resetStreamingState: vi.fn(),
      statusCheckSentAtRef,
      lastSeqRef,
      sessionStore: sessionStore as never,
    }),
    { initialProps: { ws: firstSocket } },
  );

  expect(sendMessage).toHaveBeenCalledTimes(1);
  sendMessage.mockClear();
  events.length = 0;

  act(() => rerender({ ws: replacementSocket }));

  await waitFor(() => expect(refreshLatestFromServer).toHaveBeenCalledTimes(1));
  expect(sendMessage).toHaveBeenCalledTimes(1);
  expect(sendMessage).toHaveBeenCalledWith({
    type: 'chat.subscribe',
    sessions: [{ sessionId: SESSION_ID, lastSeq: 41 }],
  });
  expect(events).toEqual(['subscribe', 'refresh']);
});
