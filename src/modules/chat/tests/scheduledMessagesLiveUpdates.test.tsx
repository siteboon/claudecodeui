import assert from 'node:assert/strict';

import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import { test, vi } from 'vitest';

import '@/modules/i18n';
import { ScheduledMessageList } from '@/modules/chat/composer/ScheduledMessageList';
import { useScheduledMessages } from '@/modules/chat/composer/useScheduledMessages';
import { useChatRealtimeHandlers } from '@/modules/chat/hooks/useChatRealtimeHandlers';
import type { SessionStore } from '@/modules/chat/hooks/useSessionStore';
import { api } from '@/shared/api';
import type { ProjectSession, ScheduledMessage, ServerEvent } from '@/shared/types';

/**
 * The scheduled-message banner above the composer used to be read only when
 * the session was opened, or when this tab scheduled or cancelled something.
 * The server's timer sends the message on its own, so the banner kept saying
 * "Scheduled for …" after the message and its reply were in the transcript,
 * until a reload (#1546). The server now announces every change to a session's
 * list, and the banner reads it again.
 */

const SESSION_ID = 'session-a';

function scheduledMessage(status: ScheduledMessage['status'], content = 'run the nightly checks'): ScheduledMessage {
  return {
    id: 'sm-1',
    sessionId: SESSION_ID,
    content,
    options: {},
    scheduledFor: '2026-10-19T17:22:00.000Z',
    status,
    failureReason: status === 'failed' ? 'provider exploded' : null,
    createdAt: '2026-10-19T17:21:15.000Z',
  };
}

function listResponse(data: unknown[]): Response {
  return { ok: true, json: async () => ({ data }) } as unknown as Response;
}

/** A stand-in for the websocket context's `subscribe`, with a way to push frames through it. */
function createSocket() {
  const listeners = new Set<(event: ServerEvent) => void>();
  return {
    subscribe: (listener: (event: ServerEvent) => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    emit: (event: ServerEvent) => {
      act(() => {
        for (const listener of listeners) {
          listener(event);
        }
      });
    },
  };
}

function Banner({ sessionId, socket }: { sessionId: string; socket: ReturnType<typeof createSocket> }) {
  const { scheduledMessages, cancel } = useScheduledMessages(sessionId, socket.subscribe);
  return <ScheduledMessageList scheduledMessages={scheduledMessages} onCancel={(id) => void cancel(id)} />;
}

test('the banner comes down when the server announces the message was sent', async () => {
  let serverState: ScheduledMessage[] = [scheduledMessage('pending')];
  vi.spyOn(api.scheduledMessages, 'list').mockImplementation(async () => listResponse(serverState));
  const socket = createSocket();

  render(<Banner sessionId={SESSION_ID} socket={socket} />);
  await screen.findByText('run the nightly checks');

  // The dispatcher claims it and starts the turn; nothing in this tab acted.
  serverState = [scheduledMessage('sent')];
  socket.emit({ kind: 'scheduled_messages_changed', sessionId: SESSION_ID });

  // Compared as a boolean: a failed assert on the element itself would
  // inspect the whole jsdom node graph on every waitFor retry.
  await waitFor(() => assert.equal(screen.queryByText('run the nightly checks') === null, true));
});

test('a message that failed to send turns into the failure notice', async () => {
  let serverState: ScheduledMessage[] = [scheduledMessage('pending')];
  vi.spyOn(api.scheduledMessages, 'list').mockImplementation(async () => listResponse(serverState));
  const socket = createSocket();

  render(<Banner sessionId={SESSION_ID} socket={socket} />);
  await screen.findByText('run the nightly checks');

  serverState = [scheduledMessage('failed')];
  socket.emit({ kind: 'scheduled_messages_changed', sessionId: SESSION_ID });

  await screen.findByText(/provider exploded/);
});

test('a message scheduled in another tab appears here too', async () => {
  let serverState: ScheduledMessage[] = [];
  const list = vi.spyOn(api.scheduledMessages, 'list').mockImplementation(async () => listResponse(serverState));
  const socket = createSocket();

  render(<Banner sessionId={SESSION_ID} socket={socket} />);
  await waitFor(() => assert.ok(list.mock.calls.length > 0));

  serverState = [scheduledMessage('pending', 'from the other tab')];
  socket.emit({ kind: 'scheduled_messages_changed', sessionId: SESSION_ID });

  await screen.findByText('from the other tab');
});

test('a change to another session\'s messages does not refetch this one', async () => {
  const list = vi.spyOn(api.scheduledMessages, 'list').mockImplementation(async () => listResponse([]));
  const socket = createSocket();

  renderHook(() => useScheduledMessages(SESSION_ID, socket.subscribe));
  await waitFor(() => assert.ok(list.mock.calls.length > 0));
  const callsBefore = list.mock.calls.length;

  socket.emit({ kind: 'scheduled_messages_changed', sessionId: 'some-other-session' });
  await act(async () => {});

  assert.equal(list.mock.calls.length, callsBefore);
});

test('after a session switch, only the newly opened session\'s announcements refetch', async () => {
  const list = vi.spyOn(api.scheduledMessages, 'list').mockImplementation(async () => listResponse([]));
  const socket = createSocket();

  const { rerender } = renderHook(({ sessionId }) => useScheduledMessages(sessionId, socket.subscribe), {
    initialProps: { sessionId: SESSION_ID },
  });
  await waitFor(() => assert.ok(list.mock.calls.length > 0));
  rerender({ sessionId: 'session-b' });
  await waitFor(() => assert.equal(list.mock.calls.at(-1)?.[0], 'session-b'));

  // The listener must follow the switch: a frame for B reads B's list.
  const callsBeforeB = list.mock.calls.length;
  socket.emit({ kind: 'scheduled_messages_changed', sessionId: 'session-b' });
  await waitFor(() => assert.equal(list.mock.calls.length, callsBeforeB + 1));
  assert.equal(list.mock.calls.at(-1)?.[0], 'session-b');

  // And a frame for the session left behind is someone else's now.
  socket.emit({ kind: 'scheduled_messages_changed', sessionId: SESSION_ID });
  await act(async () => {});
  assert.equal(list.mock.calls.length, callsBeforeB + 1);
});

test('a caller that passes no subscribe still gets the list, just not live', async () => {
  // Callers written before the announcement existed call the hook with the
  // session id alone. They keep the old behaviour instead of crashing.
  vi.spyOn(api.scheduledMessages, 'list').mockImplementation(async () => listResponse([scheduledMessage('pending')]));

  const { result } = renderHook(() => useScheduledMessages(SESSION_ID));

  await waitFor(() => assert.equal(result.current.scheduledMessages[0]?.status, 'pending'));
});

test('a reconnect reads the list again, since announcements sent while it was down are lost', async () => {
  let serverState: ScheduledMessage[] = [scheduledMessage('pending')];
  vi.spyOn(api.scheduledMessages, 'list').mockImplementation(async () => listResponse(serverState));
  const socket = createSocket();

  const { result } = renderHook(() => useScheduledMessages(SESSION_ID, socket.subscribe));
  await waitFor(() => assert.equal(result.current.scheduledMessages[0]?.status, 'pending'));

  serverState = [scheduledMessage('sent')];
  socket.emit({ kind: 'websocket_reconnected' });

  await waitFor(() => assert.equal(result.current.scheduledMessages[0]?.status, 'sent'));
});

test('an older answer that arrives last does not put the earlier state back', async () => {
  // Claimed, then failed straight away: two announcements back to back, and
  // the first request's answer is the one that comes back last.
  const pendingAnswers: Array<(response: Response) => void> = [];
  vi.spyOn(api.scheduledMessages, 'list').mockImplementation(() => new Promise<Response>((resolve) => {
    pendingAnswers.push(resolve);
  }));
  const socket = createSocket();

  const { result } = renderHook(() => useScheduledMessages(SESSION_ID, socket.subscribe));
  await waitFor(() => assert.ok(pendingAnswers.length > 0));
  await act(async () => {
    for (const answer of pendingAnswers.splice(0)) {
      answer(listResponse([scheduledMessage('pending')]));
    }
  });
  await waitFor(() => assert.equal(result.current.scheduledMessages[0]?.status, 'pending'));

  socket.emit({ kind: 'scheduled_messages_changed', sessionId: SESSION_ID });
  socket.emit({ kind: 'scheduled_messages_changed', sessionId: SESSION_ID });
  await waitFor(() => assert.equal(pendingAnswers.length, 2));
  const [older, newer] = pendingAnswers;

  await act(async () => {
    newer(listResponse([scheduledMessage('failed')]));
  });
  await act(async () => {
    older(listResponse([scheduledMessage('sent')]));
  });

  assert.equal(result.current.scheduledMessages[0]?.status, 'failed');
});

test('the announcement never lands in the transcript', () => {
  let listener: ((event: ServerEvent) => void) | null = null;
  const appended: unknown[] = [];

  renderHook(() => useChatRealtimeHandlers({
    isActive: true,
    subscribe: (fn) => {
      listener = fn;
      return () => { listener = null; };
    },
    provider: 'claude',
    selectedSession: { id: SESSION_ID } as ProjectSession,
    currentSessionId: SESSION_ID,
    setTokenBudget: () => {},
    pendingPermissionRequests: [],
    setPendingPermissionRequests: () => {},
    streamTimerRef: { current: null },
    accumulatedStreamRef: { current: '' },
    lastSeqRef: { current: new Map() },
    statusCheckSentAtRef: { current: new Map() },
    requestLatestMessages: async () => {},
    sessionStore: { appendRealtime: (...args: unknown[]) => appended.push(args) } as unknown as SessionStore,
  }));

  act(() => {
    listener?.({ kind: 'scheduled_messages_changed', sessionId: SESSION_ID, timestamp: '2026-10-19T17:22:09.000Z' });
  });

  assert.deepEqual(appended, []);
});
