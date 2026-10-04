import assert from 'node:assert/strict';

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, test, vi } from 'vitest';

import type { ProjectSession } from '@/shared/types';

/**
 * With VITE_ENABLED_PROVIDERS (#349) a new chat must start on an enabled
 * provider, while a session made with a since-disabled provider stays usable.
 * The composer's provider lives in useChatProviderState, so that is where a
 * disabled provider carried over from such a session has to give way.
 */

const okJson = (data: unknown) => Promise.resolve({
  ok: true,
  json: async () => data,
});

let enabledProviders: string[] = ['claude', 'codex', 'cursor', 'opencode'];

vi.mock('@/shared/api', () => ({
  api: {
    user: {
      preferences: () => okJson({ success: true, preferences: {} }),
      savePreferences: () => okJson({ success: true, preferences: {} }),
    },
    providers: {
      enabled: () => okJson({ success: true, data: { providers: enabledProviders } }),
      models: () => okJson({ success: true, data: null }),
      capabilities: () => okJson({ success: true, data: null }),
      sessionActiveModel: () => okJson({ success: true, data: null }),
      setSessionActiveModel: () => okJson({ success: true, data: null }),
      setSessionActiveEffort: () => okJson({ success: true, data: null }),
    },
  },
}));

const cursorSession = { id: 'cursor-session', __provider: 'cursor' } as ProjectSession;

/** Loads fresh stores, applies the server's list, then mounts the hook. */
const renderProviderState = async (
  serverList: string[],
  { storedProvider, session = null }: { storedProvider?: string; session?: ProjectSession | null } = {},
) => {
  enabledProviders = serverList;
  const { hydrateEnabledProviders } = await import('@/shared/enabledProviders');
  const { writeUserPreference, readUserPreference } = await import('@/shared/userSettings');
  const { useChatProviderState } = await import('@/modules/chat/hooks/useChatProviderState');

  if (storedProvider) {
    writeUserPreference('selectedProvider', storedProvider);
  }
  await hydrateEnabledProviders();

  const hook = renderHook(
    ({ selectedSession }: { selectedSession: ProjectSession | null }) =>
      useChatProviderState({ selectedSession, selectedProject: null }),
    { initialProps: { selectedSession: session } },
  );
  return { ...hook, readStoredProvider: () => readUserPreference('selectedProvider', null) };
};

beforeEach(() => {
  localStorage.clear();
  vi.resetModules();
});

afterEach(() => {
  vi.resetModules();
});

test('a new chat starts on the first enabled provider', async () => {
  const { result } = await renderProviderState(['codex', 'claude']);

  assert.equal(result.current.provider, 'codex');
});

test('a stored provider the server disabled is not used for a new chat', async () => {
  const { result } = await renderProviderState(['claude'], { storedProvider: 'cursor' });

  assert.equal(result.current.provider, 'claude');
});

test('a session made with a disabled provider keeps its provider', async () => {
  const { result } = await renderProviderState(['claude'], { session: cursorSession });

  assert.equal(result.current.provider, 'cursor');
});

test('leaving that session for a new chat falls back and updates storage', async () => {
  const { result, rerender, readStoredProvider } = await renderProviderState(['codex', 'claude'], {
    session: cursorSession,
  });
  assert.equal(result.current.provider, 'cursor');

  act(() => {
    rerender({ selectedSession: null });
  });

  assert.equal(result.current.provider, 'codex');
  assert.equal(readStoredProvider(), 'codex');
});

test('with every provider enabled, a new chat keeps the provider of the last session', async () => {
  // The behaviour before VITE_ENABLED_PROVIDERS existed, which an unset
  // variable must leave untouched.
  const { result, rerender, readStoredProvider } = await renderProviderState(
    ['claude', 'codex', 'cursor', 'opencode'],
    { session: cursorSession },
  );

  act(() => {
    rerender({ selectedSession: null });
  });

  assert.equal(result.current.provider, 'cursor');
  assert.equal(readStoredProvider(), 'cursor');
});
