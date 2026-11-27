import assert from 'node:assert/strict';

import { render } from '@testing-library/react';
import { test, vi } from 'vitest';

import '@/modules/i18n';
import type { Project, ProjectSession, ServerEvent } from '@/shared/types';

/**
 * The scheduled-message banner follows the server's `scheduled_messages_changed`
 * frames only because ChatInterface hands the websocket context's `subscribe`
 * to useScheduledMessages (#1546). The hook takes it as an optional second
 * argument, so a call that drops it still type-checks and the hook's own tests
 * still pass, while the banner silently goes back to stale-until-reload. This
 * renders ChatInterface with everything else stubbed to catch exactly that.
 */

const harness = vi.hoisted(() => ({
  sessionId: 'session-a',
  // The websocket context's own function; ChatInterface must pass this one on, not a stand-in.
  subscribe: (_listener: (event: ServerEvent) => void) => () => {},
  useScheduledMessages: vi.fn((_sessionId: string | null, _subscribe?: unknown) => ({
    scheduledMessages: [],
    schedule: async () => null,
    cancel: async () => false,
    refresh: async () => {},
  })),
}));

vi.mock('@/modules/chat/composer/useScheduledMessages', () => ({
  useScheduledMessages: harness.useScheduledMessages,
}));
vi.mock('@/shared/context/WebSocketContext', () => ({
  useWebSocket: () => ({ subscribe: harness.subscribe }),
}));
vi.mock('@/shared/context/SessionProtectionContext', () => ({
  useProcessingSessions: () => new Map(),
  useSessionProtectionActions: () => ({
    markSessionProcessing: () => {},
    markSessionIdle: () => {},
    markSessionBackground: () => {},
    getSessionActivity: () => null,
  }),
}));
vi.mock('@/modules/task-master', () => ({
  useTasksSettings: () => ({ tasksEnabled: false, isTaskMasterInstalled: false }),
}));
vi.mock('@/modules/command-palette', () => ({ usePaletteOpsRegister: () => {} }));
vi.mock('@/modules/chat/hooks/useChatProviderState', () => ({
  useChatProviderState: () => ({ provider: 'claude', pendingPermissionRequests: [] }),
}));
vi.mock('@/modules/chat/hooks/useChatSessionState', () => ({
  useChatSessionState: () => ({
    chatMessages: [],
    currentSessionId: harness.sessionId,
    setCurrentSessionId: () => {},
    requestLatestMessages: async () => {},
  }),
}));
vi.mock('@/modules/chat/hooks/useChatRealtimeHandlers', () => ({ useChatRealtimeHandlers: () => {} }));
vi.mock('@/modules/chat/hooks/useChatComposerState', () => ({
  useChatComposerState: () => ({ input: '', setInput: () => {}, textareaRef: { current: null } }),
}));
vi.mock('@/modules/chat/hooks/useSessionStore', () => ({ useSessionStore: () => ({}) }));
vi.mock('@/modules/chat/transcript/ChatMessagesPane', () => ({ default: () => null }));
vi.mock('@/modules/chat/composer/ChatComposer', () => ({ default: () => null }));
vi.mock('@/modules/chat/modals/CommandResultModal', () => ({ default: () => null }));

const { default: ChatInterface } = await import('@/modules/chat/ChatInterface');

const project: Project = { projectId: 'p1', displayName: 'repo', fullPath: '/work/repo', path: '/work/repo' };
const session: ProjectSession = { id: harness.sessionId, provider: 'claude' };

test('ChatInterface gives useScheduledMessages the websocket subscribe, so the banner stays live', () => {
  render(
    <ChatInterface
      isActive
      selectedProject={project}
      selectedSession={session}
      ws={null}
      sendMessage={() => {}}
    />,
  );

  const calls = harness.useScheduledMessages.mock.calls;
  assert.ok(calls.length > 0, 'ChatInterface no longer reads the scheduled list through useScheduledMessages');
  for (const [sessionId, subscribe] of calls) {
    assert.equal(sessionId, harness.sessionId);
    assert.equal(
      subscribe,
      harness.subscribe,
      'useScheduledMessages must get the websocket context\'s subscribe, or scheduled_messages_changed is never heard',
    );
  }
});
