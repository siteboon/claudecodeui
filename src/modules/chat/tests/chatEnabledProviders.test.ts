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
const claudeSession = { id: 'claude-session', __provider: 'claude' } as ProjectSession;

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

test('while that session is open, every reader of the stored provider sees it', async () => {
  // The git panel's commit message, the quick-settings slash commands and the
  // tag on locally added messages all read the stored provider. The server
  // generates commit messages only with claude or cursor, so a Claude session
  // in a codex-only setup must not read as codex.
  const { result } = await renderProviderState(['codex'], { session: claudeSession });
  const { readSelectedProvider } = await import('@/shared/selectedProvider');
  const { useSelectedProvider } = await import('@/shared/hooks/useSelectedProvider');
  const reader = renderHook(() => useSelectedProvider());

  assert.equal(result.current.provider, 'claude');
  assert.equal(readSelectedProvider(), 'claude');
  assert.equal(reader.result.current, 'claude');
});

test('a reconcile after the preferences load keeps that session in storage', async () => {
  // AuthContext reconciles once the user's preferences arrive; when that is
  // after the session opened, readers must still follow the session.
  const { result, rerender, unmount, readStoredProvider } = await renderProviderState(['codex'], {
    session: claudeSession,
  });
  const { reconcileSelectedProvider, writeSelectedProvider } = await import('@/shared/selectedProvider');

  act(() => {
    reconcileSelectedProvider();
  });
  assert.equal(result.current.provider, 'claude');
  assert.equal(readStoredProvider(), 'claude');

  // Once the session is left, or the chat view is gone, a disabled provider
  // is reconciled away again.
  act(() => {
    rerender({ selectedSession: null });
  });
  act(() => {
    writeSelectedProvider('claude');
    reconcileSelectedProvider();
  });
  assert.equal(readStoredProvider(), 'codex');

  act(() => {
    rerender({ selectedSession: claudeSession });
  });
  unmount();
  writeSelectedProvider('claude');
  reconcileSelectedProvider();
  assert.equal(readStoredProvider(), 'codex');
});

test('leaving that session for a new chat returns to the last enabled provider', async () => {
  // Not to the first enabled one: the user was on claude before opening it.
  const { result, rerender, readStoredProvider } = await renderProviderState(['codex', 'claude'], {
    storedProvider: 'claude',
  });
  assert.equal(result.current.provider, 'claude');

  act(() => {
    rerender({ selectedSession: cursorSession });
  });
  assert.equal(result.current.provider, 'cursor');

  act(() => {
    rerender({ selectedSession: null });
  });

  assert.equal(result.current.provider, 'claude');
  assert.equal(readStoredProvider(), 'claude');
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
