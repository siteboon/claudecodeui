import assert from 'node:assert/strict';

import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import { beforeEach, test, vi } from 'vitest';

import '@/modules/i18n';

import type * as SharedUtils from '@/shared/utils';
import type { ServerEvent } from '@/shared/types';

/**
 * The sidebar marker is easy to miss while the user is scrolled elsewhere, so
 * a session stopped on a question also raises a card in the workspace. These
 * tests drive the real attention provider over a mocked socket: the card must
 * name the session when its row is loaded, open it, hide when that session
 * becomes active on screen, and go away once the request is answered.
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

const setSidebarOpen = vi.fn();
const setActiveTab = vi.fn();

vi.mock('@/modules/project-workspace/context/ProjectsStateContext', () => ({
  useProjectSidebarState: () => ({
    setSidebarOpen,
    sidebarSharedProps: {
      projects: [
        {
          projectId: 'p1',
          displayName: 'HermesHome',
          fullPath: '/home/wyr/HermesHome',
          sessions: [{ id: 's1', summary: 'Hermes 在工作' }],
        },
      ],
    },
  }),
  useProjectMainState: () => ({
    setActiveTab,
  }),
}));

vi.mock('@/shared/utils', async (importOriginal) => ({
  ...(await importOriginal<typeof SharedUtils>()),
  playNotificationSound: vi.fn(),
  showAttentionTitleIndicator: vi.fn(),
  isPageActive: () => true,
}));

const { PermissionAttentionProvider } = await import('@/shared/context/PermissionAttentionContext');
const { default: AttentionToast } = await import('@/modules/project-workspace/AttentionToast');
const { default: WorkspaceStateView } = await import('@/modules/project-workspace/WorkspaceStateView');

function LocationProbe() {
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <>
      <span data-testid="location">{location.pathname}</span>
      <button type="button" data-testid="visit-s1" onClick={() => navigate('/session/s1')}>
        Visit s1
      </button>
      <button type="button" data-testid="visit-home" onClick={() => navigate('/')}>
        Visit home
      </button>
    </>
  );
}

const mount = (
  initialEntry = '/',
  toastProps: { isChatVisible?: boolean; onRevealChat?: () => void } = {},
) => {
  const view = render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <PermissionAttentionProvider>
        <AttentionToast {...toastProps} />
        <LocationProbe />
      </PermissionAttentionProvider>
    </MemoryRouter>,
  );

  return {
    location: () => screen.getByTestId('location').textContent,
    rerenderToast: (nextEntry: string, nextProps: { isChatVisible?: boolean; onRevealChat?: () => void } = {}) => {
      view.rerender(
        <MemoryRouter initialEntries={[nextEntry]}>
          <PermissionAttentionProvider>
            <AttentionToast {...nextProps} />
            <LocationProbe />
          </PermissionAttentionProvider>
        </MemoryRouter>,
      );
    },
  };
};

const send = (event: Record<string, unknown>) => {
  act(() => {
    emit?.(event as ServerEvent);
  });
};

beforeEach(() => {
  setSidebarOpen.mockClear();
  setActiveTab.mockClear();
  window.history.replaceState({}, '', '/');
});

test('a waiting question raises a card that names the session', () => {
  mount();
  assert.equal(screen.queryByRole('status'), null);

  send({ kind: 'permission_attention', sessionId: 's1', requestId: 'r1', toolName: 'AskUserQuestion' });

  const card = screen.getByRole('status');
  assert.match(card.textContent ?? '', /Your answer is needed/);
  assert.match(card.textContent ?? '', /Hermes 在工作/);
});

test('the card opens the blocked conversation, closes mobile sidebar, and activates chat tab', () => {
  const view = mount();
  send({ kind: 'permission_attention', sessionId: 's1', requestId: 'r1' });

  fireEvent.click(screen.getByRole('button', { name: 'Open' }));

  assert.equal(setSidebarOpen.mock.calls.length, 1);
  assert.equal(setSidebarOpen.mock.calls[0][0], false);
  assert.equal(setActiveTab.mock.calls.length, 1);
  assert.equal(setActiveTab.mock.calls[0][0], 'chat');
  assert.equal(view.location(), '/session/s1');
  assert.equal(screen.queryByRole('status'), null, 'the card is not needed once the user is on the session');
});

test('opening the session from elsewhere hides the toast, and leaving unanswered brings it back', () => {
  mount();
  send({ kind: 'permission_attention', sessionId: 's1', requestId: 'r1' });
  assert.ok(screen.getByRole('status'));

  fireEvent.click(screen.getByTestId('visit-s1'));
  assert.equal(screen.queryByRole('status'), null);

  fireEvent.click(screen.getByTestId('visit-home'));
  assert.ok(screen.getByRole('status'));
});

test('a snapshot after reload or reconnect surfaces an off-screen waiting session until dismissed', () => {
  mount();
  send({
    kind: 'permission_attention_snapshot',
    sessions: [{ sessionId: 's1', requestId: 'r1' }],
  });

  const card = screen.getByRole('status');
  assert.match(card.textContent ?? '', /Hermes 在工作/);

  fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
  assert.equal(screen.queryByRole('status'), null);

  send({
    kind: 'permission_attention_snapshot',
    sessions: [{ sessionId: 's1', requestId: 'r1' }],
  });
  assert.equal(screen.queryByRole('status'), null);
});

test('a session id containing percent signs in the route does not throw URIError', () => {
  mount('/session/100%25raw%');
  send({ kind: 'permission_attention', sessionId: 's1', requestId: 'r1' });

  assert.ok(screen.getByRole('status'));
});

test('mobile WorkspaceStateView mounts AttentionToast inside the body container below the menu bar', () => {
  const onRevealChat = vi.fn();
  render(
    <MemoryRouter initialEntries={['/']}>
      <PermissionAttentionProvider>
        <WorkspaceStateView mode="empty" isMobile onMenuClick={() => {}} onRevealChat={onRevealChat} />
      </PermissionAttentionProvider>
    </MemoryRouter>,
  );

  send({ kind: 'permission_attention', sessionId: 's1', requestId: 'r1' });

  const menuButton = screen.getByRole('button', { name: 'Open menu' });
  const card = screen.getByRole('status');
  const headerBar = menuButton.parentElement;
  const toastWrapper = card.parentElement;

  assert.ok(headerBar && toastWrapper);
  assert.equal(headerBar.contains(card), false, 'toast must sit below the mobile header bar, never inside it');
  assert.equal(toastWrapper.className.includes('absolute'), true);
  assert.equal(toastWrapper.className.includes('fixed'), false);
  fireEvent.click(screen.getByRole('button', { name: 'Open' }));
  assert.equal(onRevealChat.mock.calls.length, 1);
});

test('shows remaining waiting session count when multiple sessions are blocked', () => {
  mount();
  send({ kind: 'permission_attention', sessionId: 's1', requestId: 'r1' });
  send({ kind: 'permission_attention', sessionId: 's2', requestId: 'r2' });

  const card = screen.getByRole('status');
  assert.match(card.textContent ?? '', /\+1 more waiting/);
});

test('dismissing the card leaves the session marked for the sidebar', () => {
  mount();
  send({ kind: 'permission_attention', sessionId: 's1', requestId: 'r1' });

  fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));

  assert.equal(screen.queryByRole('status'), null);
});

test('answering the question takes the card down', () => {
  mount();
  send({ kind: 'permission_attention', sessionId: 's1', requestId: 'r1' });
  assert.ok(screen.getByRole('status'));

  send({ kind: 'permission_attention_cleared', sessionId: 's1', requestId: 'r1' });

  assert.equal(screen.queryByRole('status'), null);
});

test('a replayed announcement does not reopen a dismissed card', () => {
  mount();
  send({ kind: 'permission_attention', sessionId: 's1', requestId: 'r1' });
  fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));

  send({ kind: 'permission_attention', sessionId: 's1', requestId: 'r1' });

  assert.equal(screen.queryByRole('status'), null);
});

test('on the waiting session, hiding chat (Files tab or expanded editor) surfaces its toast and Dismiss still clears it', () => {
  const onRevealChat = vi.fn();
  const view = mount('/session/s1', { isChatVisible: false, onRevealChat });

  send({ kind: 'permission_attention', sessionId: 's1', requestId: 'r1' });

  const card = screen.getByRole('status');
  assert.match(card.textContent ?? '', /Hermes 在工作/);

  fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
  assert.equal(screen.queryByRole('status'), null);

  // Returning to chat while the request is still pending does not show it, and
  // a new request on s1 still surfaces when chat is hidden again.
  send({ kind: 'permission_attention', sessionId: 's1', requestId: 'r2' });
  assert.ok(screen.getByRole('status'));

  fireEvent.click(screen.getByRole('button', { name: 'Open' }));
  assert.equal(onRevealChat.mock.calls.length, 1);
  assert.equal(setActiveTab.mock.calls.at(-1)?.[0], 'chat');

  view.rerenderToast('/session/s1', { isChatVisible: true, onRevealChat });
  assert.equal(screen.queryByRole('status'), null, 'toast hides once chat is visible again');
});

test('Open invokes onRevealChat when navigating to another waiting session while the editor is expanded', () => {
  const onRevealChat = vi.fn();
  const view = mount('/session/s2', { isChatVisible: false, onRevealChat });

  send({ kind: 'permission_attention', sessionId: 's1', requestId: 'r1' });
  assert.ok(screen.getByRole('status'));

  fireEvent.click(screen.getByRole('button', { name: 'Open' }));
  assert.equal(onRevealChat.mock.calls.length, 1);
  assert.equal(setActiveTab.mock.calls[0][0], 'chat');
  assert.equal(view.location(), '/session/s1');
});
