import assert from 'node:assert/strict';

import { act, render } from '@testing-library/react';
import { beforeEach, test, vi } from 'vitest';

import type * as SharedUtils from '@/shared/utils';
import type { ServerEvent } from '@/shared/types';

/**
 * A prompt raised in a session the user is not looking at used to leave no
 * trace at all. The provider under test is what turns the server's
 * `permission_attention` broadcast and `permission_attention_snapshot` catch-up
 * into (a) a sidebar marker, (b) an alert (suppressed when the session is
 * already on screen in an active tab), and (c) the toast card notice.
 */

let emit: ((event: ServerEvent) => void) | null = null;

// Hoisted so the mock factory (which runs before module initialization) can
// read the current connection status and the send spy.
const socket = vi.hoisted(() => ({
  status: 'connected' as 'connected' | 'connecting' | 'disconnected',
  sendMessage: vi.fn(),
}));

vi.mock('@/shared/context/WebSocketContext', () => ({
  useWebSocket: () => ({
    subscribe: (handler: (event: ServerEvent) => void) => {
      emit = handler;
      return () => {
        emit = null;
      };
    },
    sendMessage: socket.sendMessage,
    connectionStatus: socket.status,
  }),
}));

const playNotificationSound = vi.fn();
const showAttentionTitleIndicator = vi.fn();
const isPageActive = vi.fn(() => true);

vi.mock('@/shared/utils', async (importOriginal) => ({
  ...(await importOriginal<typeof SharedUtils>()),
  playNotificationSound,
  showAttentionTitleIndicator,
  isPageActive,
}));

const {
  PermissionAttentionProvider,
  useAwaitingInputSessionIdSet,
  useDismissAttentionNotice,
  useLatestAttentionNotice,
} = await import('@/shared/context/PermissionAttentionContext');

function AwaitingSessions({ viewedSessionId }: { viewedSessionId?: string | null }) {
  const awaiting = useAwaitingInputSessionIdSet();
  const notice = useLatestAttentionNotice(viewedSessionId);
  const dismissNotice = useDismissAttentionNotice();
  return (
    <>
      <span data-testid="awaiting">{[...awaiting].sort().join(',')}</span>
      <span data-testid="notice">{notice ? `${notice.sessionId}/${notice.requestId}` : ''}</span>
      <button
        type="button"
        data-testid="dismiss"
        onClick={() => notice && dismissNotice(notice.requestId, viewedSessionId)}
      >
        Dismiss
      </button>
    </>
  );
}

const tree = (viewedSessionId?: string | null) => (
  <PermissionAttentionProvider>
    <AwaitingSessions viewedSessionId={viewedSessionId} />
  </PermissionAttentionProvider>
);

const mount = (viewedSessionId?: string | null) => {
  let currentViewedSessionId = viewedSessionId;
  const view = render(tree(currentViewedSessionId));

  return {
    awaiting: () => view.getByTestId('awaiting').textContent,
    notice: () => view.getByTestId('notice').textContent,
    dismiss: () => act(() => {
      view.getByTestId('dismiss').click();
    }),
    setViewedSessionId: (nextViewedSessionId?: string | null) => {
      currentViewedSessionId = nextViewedSessionId;
      view.rerender(tree(currentViewedSessionId));
    },
    /** Moves the socket to another status, as the provider tree would see it. */
    setConnectionStatus: (status: 'connected' | 'connecting' | 'disconnected') => {
      socket.status = status;
      view.rerender(tree(currentViewedSessionId));
    },
  };
};

const send = (event: Record<string, unknown>) => {
  act(() => {
    emit?.(event as ServerEvent);
  });
};

beforeEach(() => {
  playNotificationSound.mockClear();
  showAttentionTitleIndicator.mockClear();
  isPageActive.mockReset();
  isPageActive.mockReturnValue(true);
  socket.sendMessage.mockClear();
  socket.status = 'connected';
  window.history.replaceState({}, '', '/');
});

test('a request marks its session, even one nobody is looking at', () => {
  const view = mount();

  send({ kind: 'permission_attention', sessionId: 's1', requestId: 'r1', toolName: 'AskUserQuestion' });

  assert.equal(view.awaiting(), 's1');
  assert.equal(view.notice(), 's1/r1');
  assert.equal(playNotificationSound.mock.calls.length, 1);
  assert.equal(showAttentionTitleIndicator.mock.calls.length, 1);
});

test('a session stays marked until its last request is answered', () => {
  const view = mount();

  send({ kind: 'permission_attention', sessionId: 's1', requestId: 'r1' });
  send({ kind: 'permission_attention', sessionId: 's1', requestId: 'r2' });
  assert.equal(view.awaiting(), 's1');
  assert.equal(view.notice(), 's1/r2', 'the toast follows the newest request');

  send({ kind: 'permission_attention_cleared', sessionId: 's1', requestId: 'r1' });
  assert.equal(view.awaiting(), 's1', 'one request is still waiting');
  assert.equal(view.notice(), 's1/r2');

  send({ kind: 'permission_attention_cleared', sessionId: 's1', requestId: 'r2' });
  assert.equal(view.awaiting(), '');
  assert.equal(view.notice(), '');
});

test('a finished run clears the whole session', () => {
  const view = mount();

  send({ kind: 'permission_attention', sessionId: 's1', requestId: 'r1' });
  send({ kind: 'permission_attention_cleared', sessionId: 's1', requestId: null });

  assert.equal(view.awaiting(), '');
  assert.equal(view.notice(), '');
});

test('the conversation on screen is not alerted twice', () => {
  window.history.replaceState({}, '', '/session/s1');
  const view = mount();

  send({ kind: 'permission_attention', sessionId: 's1', requestId: 'r1' });
  assert.equal(view.awaiting(), 's1');
  assert.equal(view.notice(), '', 'an open active session already shows the prompt inline');
  assert.equal(playNotificationSound.mock.calls.length, 0);
  assert.equal(showAttentionTitleIndicator.mock.calls.length, 0);

  send({ kind: 'permission_attention', sessionId: 's2', requestId: 'r9' });
  assert.equal(view.notice(), 's2/r9');
  assert.equal(playNotificationSound.mock.calls.length, 1, 'another session still alerts');
});

test('a prompt in a backgrounded tab still raises the title indicator', () => {
  window.history.replaceState({}, '', '/session/s1');
  isPageActive.mockReturnValue(false);
  const view = mount();

  send({ kind: 'permission_attention', sessionId: 's1', requestId: 'r1' });

  assert.equal(view.notice(), '');
  assert.equal(playNotificationSound.mock.calls.length, 0, 'the open chat already sounds the prompt');
  assert.equal(showAttentionTitleIndicator.mock.calls.length, 1);
});

test('a replayed announcement does not alert twice or reopen a dismissed notice', () => {
  const view = mount();

  send({ kind: 'permission_attention', sessionId: 's1', requestId: 'r1' });
  view.dismiss();
  assert.equal(view.notice(), '');

  send({ kind: 'permission_attention', sessionId: 's1', requestId: 'r1' });

  assert.equal(view.awaiting(), 's1');
  assert.equal(view.notice(), '');
  assert.equal(playNotificationSound.mock.calls.length, 1);
});

test('each handshake asks for the waiting set, and a reconnect asks again', () => {
  const { setConnectionStatus } = mount();
  assert.deepEqual(
    socket.sendMessage.mock.calls.map((call) => call[0]),
    [{ type: 'chat.attention-snapshot' }],
    'the first connection asks too: requests can predate this page load',
  );

  setConnectionStatus('disconnected');
  assert.equal(socket.sendMessage.mock.calls.length, 1, 'nothing is asked while the socket is down');

  setConnectionStatus('connected');
  assert.equal(socket.sendMessage.mock.calls.length, 2, 'reconnecting asks for the current set');
});

test('the waiting set from the server replaces what the deltas built', () => {
  const view = mount();

  send({ kind: 'permission_attention', sessionId: 's1', requestId: 'r1' });
  send({ kind: 'permission_attention', sessionId: 's2', requestId: 'r2' });
  assert.equal(view.awaiting(), 's1,s2');
  assert.equal(view.notice(), 's2/r2');

  // Requests raised while offline show up, and cleared noticed requests drop …
  send({
    kind: 'permission_attention_snapshot',
    sessions: [
      { sessionId: 's1', requestId: 'r1' },
      { sessionId: 's3', requestId: 'r3' },
    ],
  });
  assert.equal(view.awaiting(), 's1,s3', 's2 was answered while this client was away');
  assert.equal(view.notice(), 's3/r3', 'the snapshot surfaces the newest off-screen waiting request');

  // … and an empty set clears markers whose clears were missed.
  send({ kind: 'permission_attention_snapshot', sessions: [] });
  assert.equal(view.awaiting(), '');
  assert.equal(view.notice(), '');

  assert.equal(playNotificationSound.mock.calls.length, 2, 'a snapshot is not a new arrival to alert on');
  assert.equal(showAttentionTitleIndicator.mock.calls.length, 2);
});

test('a snapshot keeps dismissed notices hidden and alerts the title when backgrounded', () => {
  const view = mount();

  send({ kind: 'permission_attention', sessionId: 's1', requestId: 'r1' });
  view.dismiss();
  assert.equal(view.notice(), '');

  isPageActive.mockReturnValue(false);
  send({
    kind: 'permission_attention_snapshot',
    sessions: [{ sessionId: 's1', requestId: 'r1' }],
  });

  assert.equal(view.awaiting(), 's1');
  assert.equal(view.notice(), '', 'reconnecting must not reopen a dismissed request');
  assert.equal(playNotificationSound.mock.calls.length, 1);
  assert.equal(showAttentionTitleIndicator.mock.calls.length, 2, 'a backgrounded tab still gets the title cue');
});

test('leaving a blocked session without answering surfaces its toast notice', () => {
  window.history.replaceState({}, '', '/session/s1');
  const view = mount('s1');

  send({ kind: 'permission_attention', sessionId: 's1', requestId: 'r1' });
  assert.equal(view.notice(), '', 'hidden while the blocked session is on screen');

  view.setViewedSessionId('s2');
  assert.equal(view.notice(), 's1/r1', 'reminds as soon as the user navigates away');
});

test('an announcement without a request id cannot be tracked and is ignored', () => {
  const view = mount();

  send({ kind: 'permission_attention', sessionId: 's1' });

  assert.equal(view.awaiting(), '');
  assert.equal(view.notice(), '');
  assert.equal(playNotificationSound.mock.calls.length, 0);
});
