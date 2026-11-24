import assert from 'node:assert/strict';

import { act, render } from '@testing-library/react';
import { beforeEach, test, vi } from 'vitest';

import type * as SharedUtils from '@/shared/utils';
import type { ServerEvent } from '@/shared/types';

/**
 * A prompt raised in a session the user is not looking at used to leave no
 * trace at all. The provider under test is what turns the server's
 * `permission_attention` broadcast into (a) a sidebar marker and (b) an alert —
 * and the alert must not double up with the one the open conversation already
 * plays for the prompt it is showing.
 */

let emit: ((event: ServerEvent) => void) | null = null;

vi.mock('@/shared/context/WebSocketContext', () => ({
  useWebSocket: () => ({
    subscribe: (handler: (event: ServerEvent) => void) => {
      emit = handler;
      return () => {
        emit = null;
      };
    },
  }),
}));

const playNotificationSound = vi.fn();
const showAttentionTitleIndicator = vi.fn();

vi.mock('@/shared/utils', async (importOriginal) => ({
  ...(await importOriginal<typeof SharedUtils>()),
  playNotificationSound,
}));

vi.mock('@/modules/chat/utils/pageTitleNotification', () => ({
  showAttentionTitleIndicator,
}));

const { PermissionAttentionProvider, useAwaitingInputSessionIdSet } = await import(
  '@/shared/context/PermissionAttentionContext'
);

function AwaitingSessions() {
  const awaiting = useAwaitingInputSessionIdSet();
  return <span data-testid="awaiting">{[...awaiting].sort().join(',')}</span>;
}

const mount = () => {
  const view = render(
    <PermissionAttentionProvider>
      <AwaitingSessions />
    </PermissionAttentionProvider>,
  );

  return () => view.getByTestId('awaiting').textContent;
};

const send = (event: Record<string, unknown>) => {
  act(() => {
    emit?.(event as ServerEvent);
  });
};

beforeEach(() => {
  playNotificationSound.mockClear();
  showAttentionTitleIndicator.mockClear();
  window.history.replaceState({}, '', '/');
});

test('a request marks its session, even one nobody is looking at', () => {
  const awaiting = mount();

  send({ kind: 'permission_attention', sessionId: 's1', requestId: 'r1', toolName: 'AskUserQuestion' });

  assert.equal(awaiting(), 's1');
  assert.equal(playNotificationSound.mock.calls.length, 1);
  assert.equal(showAttentionTitleIndicator.mock.calls.length, 1);
});

test('a session stays marked until its last request is answered', () => {
  const awaiting = mount();

  send({ kind: 'permission_attention', sessionId: 's1', requestId: 'r1' });
  send({ kind: 'permission_attention', sessionId: 's1', requestId: 'r2' });
  assert.equal(awaiting(), 's1');

  send({ kind: 'permission_attention_cleared', sessionId: 's1', requestId: 'r1' });
  assert.equal(awaiting(), 's1', 'one request is still waiting');

  send({ kind: 'permission_attention_cleared', sessionId: 's1', requestId: 'r2' });
  assert.equal(awaiting(), '');
});

test('a finished run clears the whole session', () => {
  const awaiting = mount();

  send({ kind: 'permission_attention', sessionId: 's1', requestId: 'r1' });
  send({ kind: 'permission_attention_cleared', sessionId: 's1', requestId: null });

  assert.equal(awaiting(), '');
});

test('the conversation on screen is not alerted twice', () => {
  window.history.replaceState({}, '', '/session/s1');
  const awaiting = mount();

  send({ kind: 'permission_attention', sessionId: 's1', requestId: 'r1' });
  assert.equal(awaiting(), 's1');
  assert.equal(playNotificationSound.mock.calls.length, 0);
  assert.equal(showAttentionTitleIndicator.mock.calls.length, 0);

  send({ kind: 'permission_attention', sessionId: 's2', requestId: 'r9' });
  assert.equal(playNotificationSound.mock.calls.length, 1, 'another session still alerts');
});

test('an announcement without a request id cannot be tracked and is ignored', () => {
  const awaiting = mount();

  send({ kind: 'permission_attention', sessionId: 's1' });

  assert.equal(awaiting(), '');
  assert.equal(playNotificationSound.mock.calls.length, 0);
});
