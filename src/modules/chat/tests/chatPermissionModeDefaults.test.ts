import assert from 'node:assert/strict';

import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, test, vi } from 'vitest';

import type { ProjectSession } from '@/shared/types';
import { resetUserPreferences, writeUserPreference } from '@/shared/userSettings';

/**
 * Which permission mode the composer starts in (#1263). The precedence is:
 * an explicit per-session choice, then the mode saved in the provider's
 * Settings, then the provider's capability default — and a mode picked before
 * a brand-new chat's first send has to survive the session id arriving.
 */

const okJson = (data: unknown) => Promise.resolve({
  ok: true,
  json: async () => data,
});

vi.mock('@/shared/api', () => ({
  api: {
    user: {
      preferences: () => okJson({ success: true, preferences: {} }),
      savePreferences: () => okJson({ success: true, preferences: {} }),
    },
    providers: {
      models: () => okJson({ success: true, data: null }),
      // No capability matrix: the hook uses its static fallback, where Codex
      // offers default / acceptEdits / bypassPermissions and defaults to `default`.
      capabilities: () => okJson({ success: true, data: null }),
      sessionActiveModel: () => okJson({ success: true, data: null }),
      setSessionActiveModel: () => okJson({ success: true, data: null }),
      setSessionActiveEffort: () => okJson({ success: true, data: null }),
      createModel: () => okJson({ success: true, data: null }),
      updateModel: () => okJson({ success: true, data: null }),
      removeModel: () => okJson({ success: true, data: null }),
    },
  },
}));

const codexSession = (id: string): ProjectSession => ({ id, __provider: 'codex' } as ProjectSession);

const renderProviderState = async (initialSession: ProjectSession | null = null) => {
  const { useChatProviderState } = await import(
    '@/modules/chat/hooks/useChatProviderState'
  );
  // `vi.resetModules` gives each test a fresh preference store; a write made
  // after render has to go through the instance the hook subscribed to.
  const { writeUserPreference: writeLivePreference } = await import('@/shared/userSettings');
  const rendered = renderHook(
    ({ selectedSession }: { selectedSession: ProjectSession | null }) =>
      useChatProviderState({ selectedSession, selectedProject: null }),
    { initialProps: { selectedSession: initialSession } },
  );
  return { ...rendered, writeLivePreference };
};

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  resetUserPreferences();
  writeUserPreference('selectedProvider', 'codex');
});

afterEach(() => {
  vi.resetModules();
});

test('a new Codex chat starts in the permission mode saved in Settings', async () => {
  writeUserPreference('codexPermissions', { permissionMode: 'bypassPermissions' });

  const { result } = await renderProviderState();

  await waitFor(() => {
    assert.equal(result.current.permissionMode, 'bypassPermissions');
  });
});

test('an existing Codex session without its own choice uses the Settings mode', async () => {
  writeUserPreference('codexPermissions', { permissionMode: 'acceptEdits' });

  const { result } = await renderProviderState(codexSession('codex-existing'));

  await waitFor(() => {
    assert.equal(result.current.permissionMode, 'acceptEdits');
  });
});

test('an explicit per-session choice outranks the Settings mode', async () => {
  writeUserPreference('codexPermissions', { permissionMode: 'bypassPermissions' });
  localStorage.setItem('permissionMode-codex-pinned', 'acceptEdits');

  const { result } = await renderProviderState(codexSession('codex-pinned'));

  await waitFor(() => {
    assert.equal(result.current.permissionMode, 'acceptEdits');
  });
});

test('a mode last picked in another chat does not override the Settings mode', async () => {
  // Written by every composer pick before #1263; an upgrading user has one.
  localStorage.setItem('permissionMode-last-codex', 'default');
  writeUserPreference('codexPermissions', { permissionMode: 'bypassPermissions' });

  const { result } = await renderProviderState();

  await waitFor(() => {
    assert.equal(result.current.permissionMode, 'bypassPermissions');
  });
});

test('the composer follows a Settings change while the chat has no choice of its own', async () => {
  writeUserPreference('codexPermissions', { permissionMode: 'default' });

  const { result, writeLivePreference } = await renderProviderState();
  await waitFor(() => {
    assert.equal(result.current.permissionMode, 'default');
  });

  act(() => {
    writeLivePreference('codexPermissions', { permissionMode: 'bypassPermissions' });
  });

  await waitFor(() => {
    assert.equal(result.current.permissionMode, 'bypassPermissions');
  });
});

test('a mode picked before the first send is bound to the new session id', async () => {
  writeUserPreference('codexPermissions', { permissionMode: 'bypassPermissions' });

  const { result, rerender, writeLivePreference } = await renderProviderState();
  await waitFor(() => {
    assert.equal(result.current.permissionMode, 'bypassPermissions');
  });

  act(() => {
    result.current.selectPermissionMode('acceptEdits');
  });
  // A Settings write in the meantime must not clobber the explicit pick.
  act(() => {
    writeLivePreference('codexPermissions', { permissionMode: 'default' });
  });
  assert.equal(result.current.permissionMode, 'acceptEdits');

  // The composer allocates the id on the first send, then the chat navigates to it.
  act(() => {
    result.current.bindNewChatPermissionMode('codex-new');
  });
  rerender({ selectedSession: codexSession('codex-new') });

  await waitFor(() => {
    assert.equal(result.current.permissionMode, 'acceptEdits');
  });
  assert.equal(localStorage.getItem('permissionMode-codex-new'), 'acceptEdits');

  // The pick belonged to that chat only; the next new chat starts from Settings.
  rerender({ selectedSession: null });
  await waitFor(() => {
    assert.equal(result.current.permissionMode, 'default');
  });
});

test('a pick made before the first send survives a reload of the tab', async () => {
  writeUserPreference('codexPermissions', { permissionMode: 'bypassPermissions' });

  const beforeReload = await renderProviderState();
  await waitFor(() => {
    assert.equal(beforeReload.result.current.permissionMode, 'bypassPermissions');
  });
  act(() => {
    beforeReload.result.current.selectPermissionMode('default');
  });
  beforeReload.unmount();

  // The draft comes back after a reload, so the safer mode picked for it must too.
  const afterReload = await renderProviderState();
  await waitFor(() => {
    assert.equal(afterReload.result.current.permissionMode, 'default');
  });

  act(() => {
    afterReload.result.current.bindNewChatPermissionMode('codex-reloaded');
  });
  assert.equal(localStorage.getItem('permissionMode-codex-reloaded'), 'default');
});

test('a pick left unsent in a new chat is dropped once another session is opened', async () => {
  writeUserPreference('codexPermissions', { permissionMode: 'default' });

  const { result, rerender } = await renderProviderState();
  await waitFor(() => {
    assert.equal(result.current.availablePermissionModes.includes('bypassPermissions'), true);
  });
  act(() => {
    result.current.selectPermissionMode('bypassPermissions');
  });

  // The user leaves without sending and works in an existing session instead.
  rerender({ selectedSession: codexSession('codex-other') });
  await waitFor(() => {
    assert.equal(result.current.permissionMode, 'default');
  });
  act(() => {
    result.current.selectPermissionMode('acceptEdits');
  });

  rerender({ selectedSession: null });
  await waitFor(() => {
    assert.equal(result.current.permissionMode, 'default');
  });
});

test('a fork keeps the permission mode chosen for the session it was forked from', async () => {
  writeUserPreference('codexPermissions', { permissionMode: 'bypassPermissions' });
  localStorage.setItem('permissionMode-codex-parent', 'default');

  // What the chat and sidebar fork actions do once the server returns the fork's id.
  const { inheritSessionPermissionMode } = await import('@/shared/utils');
  inheritSessionPermissionMode('codex-parent', 'codex-fork');
  inheritSessionPermissionMode('codex-unpinned-parent', 'codex-unpinned-fork');

  const { result, rerender } = await renderProviderState(codexSession('codex-fork'));
  await waitFor(() => {
    assert.equal(result.current.permissionMode, 'default');
  });

  // A source without a choice of its own passes nothing on, so its fork follows Settings.
  assert.equal(localStorage.getItem('permissionMode-codex-unpinned-fork'), null);
  rerender({ selectedSession: codexSession('codex-unpinned-fork') });
  await waitFor(() => {
    assert.equal(result.current.permissionMode, 'bypassPermissions');
  });
});

test('a new chat with no pick leaves the session free to follow Settings', async () => {
  writeUserPreference('codexPermissions', { permissionMode: 'bypassPermissions' });

  const { result, rerender } = await renderProviderState();
  await waitFor(() => {
    assert.equal(result.current.permissionMode, 'bypassPermissions');
  });

  act(() => {
    result.current.bindNewChatPermissionMode('codex-unpinned');
  });
  rerender({ selectedSession: codexSession('codex-unpinned') });

  assert.equal(localStorage.getItem('permissionMode-codex-unpinned'), null);
  await waitFor(() => {
    assert.equal(result.current.permissionMode, 'bypassPermissions');
  });
});

test('the capability default applies when nothing is saved anywhere', async () => {
  const { result } = await renderProviderState();

  await waitFor(() => {
    assert.equal(result.current.availablePermissionModes.includes('bypassPermissions'), true);
  });
  assert.equal(result.current.permissionMode, 'default');
});

test('a Settings mode the provider does not offer is ignored', async () => {
  // `plan` is not a Codex mode; a hand-edited or stale value must not leak through.
  writeUserPreference('codexPermissions', { permissionMode: 'plan' });

  const { result } = await renderProviderState();

  await waitFor(() => {
    assert.equal(result.current.availablePermissionModes.includes('default'), true);
  });
  assert.equal(result.current.permissionMode, 'default');
});

test('Claude’s skipPermissions setting is not treated as a composer mode', async () => {
  writeUserPreference('selectedProvider', 'claude');
  writeUserPreference('claudePermissions', { allowedTools: [], disallowedTools: [], skipPermissions: true });
  localStorage.setItem('permissionMode-last-claude', 'plan');

  const { result } = await renderProviderState();

  // Claude's Settings store no mode, so its last composer pick still applies.
  await waitFor(() => {
    assert.equal(result.current.permissionMode, 'plan');
  });
});
