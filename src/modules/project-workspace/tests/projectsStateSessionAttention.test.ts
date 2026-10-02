import assert from 'node:assert/strict';

import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, test, vi } from 'vitest';

import type { Project } from '@/shared/types';

/**
 * The sidebar flags a session the user is not looking at when something
 * happens in it. `chat_send_accepted` is not such a thing: it is the
 * composer's own receipt for a message the user just sent, and for a new chat
 * it arrives before the composer opens the session it was sent to (#1452).
 */

const projectsResponse = vi.fn();

vi.mock('@/shared/api', () => ({
  api: {
    projects: () => projectsResponse(),
    projectTaskmaster: () => Promise.resolve({ ok: false }),
    sessionDetails: () => Promise.resolve({ ok: false }),
    projectSessions: () => Promise.resolve({ ok: false }),
  },
}));

const NEW_SESSION_ID = 'new-session';

const PROJECT: Project = {
  projectId: 'project-1',
  path: '/repo',
  fullPath: '/repo',
  displayName: 'Repo',
  isStarred: false,
  sessions: [],
  sessionMeta: { hasMore: false, total: 0 },
};

type ServerEventListener = (event: Record<string, unknown>) => void;

const listeners = new Set<ServerEventListener>();

const emit = (event: Record<string, unknown>) => {
  for (const listener of listeners) {
    listener(event);
  }
};

const renderProjectsState = async () => {
  const { useProjectsState } = await import(
    '@/modules/project-workspace/hooks/useProjectsState'
  );

  // No session in the URL: the user is in the new-chat composer.
  return renderHook(() =>
    useProjectsState({
      sessionId: undefined,
      navigate: vi.fn(),
      subscribe: (listener: ServerEventListener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      isMobile: false,
      isSessionProcessing: () => false,
    }),
  );
};

beforeEach(() => {
  localStorage.clear();
  projectsResponse.mockReset();
  projectsResponse.mockResolvedValue({ ok: true, json: async () => [PROJECT] });
  listeners.clear();
});

afterEach(() => {
  vi.resetModules();
});

test('the acknowledgement of a sent message does not flag its session for attention', async () => {
  const { result } = await renderProjectsState();
  await waitFor(() => {
    assert.ok(result.current.selectedProject);
  });

  await act(async () => {
    emit({ kind: 'chat_send_accepted', sessionId: NEW_SESSION_ID, clientRequestId: 'request-1' });
  });
  assert.equal(result.current.sidebarSharedProps.attentionSessionIds.has(NEW_SESSION_ID), false);

  // Whereas the reply streaming into a session that is not on screen is.
  await act(async () => {
    emit({ kind: 'text', sessionId: NEW_SESSION_ID, content: 'a reply' });
  });
  assert.equal(result.current.sidebarSharedProps.attentionSessionIds.has(NEW_SESSION_ID), true);
});
