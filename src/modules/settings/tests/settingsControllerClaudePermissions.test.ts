import assert from 'node:assert/strict';

import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, test, vi } from 'vitest';

/**
 * The permission prompt timeout (issue #607) lives in the `claudePermissions`
 * preference beside the allowed and blocked tools, and the whole object is
 * written back on every save. So the controller has to both load the stored
 * timeout and carry it into every save: otherwise editing an allowed tool, or
 * merely opening the dialog, silently resets the timeout to "never".
 */

vi.mock('@/shared/api', () => {
  const ok = async () => new Response('{}', {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

  return {
    api: {
      settings: {
        notificationPreferences: () => Promise.resolve({ ok: false }),
        saveNotificationPreferences: () => Promise.resolve({ ok: true, json: async () => ({}) }),
      },
      user: {
        preferences: async () => new Response(JSON.stringify({ preferences: {} }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
        savePreferences: ok,
        drafts: ok,
        saveDraft: ok,
        deleteDraft: ok,
      },
    },
  };
});

// Stable identities: the hook's open-effect depends on these functions, so
// fresh ones each render would re-run it forever.
vi.mock('@/shared/context/ThemeContext', () => {
  const theme = { isDarkMode: false, toggleDarkMode: () => undefined };
  return { useTheme: () => theme };
});

vi.mock('@/modules/provider-auth', () => {
  const authStatus = {
    providerAuthStatus: {},
    checkProviderAuthStatus: () => Promise.resolve({ authenticated: false }),
    refreshProviderAuthStatuses: () => Promise.resolve(),
  };
  return { useProviderAuthStatus: () => authStatus };
});

/** The single localStorage blob the preference store mirrors the server into. */
const MIRROR_STORAGE_KEY = 'user-preferences';

/** Seeds the mirror before the controller (and so the store) is imported. */
const seedClaudePermissions = (claudePermissions: Record<string, unknown>) => {
  localStorage.setItem(MIRROR_STORAGE_KEY, JSON.stringify({ claudePermissions }));
};

const storedClaudePermissions = (): Record<string, unknown> | undefined => {
  const raw = localStorage.getItem(MIRROR_STORAGE_KEY);
  return raw === null
    ? undefined
    : (JSON.parse(raw) as { claudePermissions?: Record<string, unknown> }).claudePermissions;
};

const renderSettings = async () => {
  const { useSettingsController } = await import('@/modules/settings/hooks/useSettingsController');
  return renderHook(() => useSettingsController({ isOpen: true, initialTab: 'agents' }));
};

// The controller auto-saves 500 ms after the last change.
const SAVE_WAIT = { timeout: 3_000 };

beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
});

afterEach(() => {
  vi.resetModules();
});

test('a user who never set a timeout loads "wait indefinitely"', async () => {
  seedClaudePermissions({ allowedTools: ['Read'], disallowedTools: [], skipPermissions: false });

  const { result } = await renderSettings();

  await waitFor(() => {
    assert.deepEqual(result.current.claudePermissions.allowedTools, ['Read']);
  });
  assert.equal(result.current.claudePermissions.permissionPromptTimeoutMs, 0);
});

test('a stored timeout is loaded into the Claude permissions', async () => {
  seedClaudePermissions({
    allowedTools: ['Read'],
    disallowedTools: [],
    skipPermissions: false,
    permissionPromptTimeoutMs: 300_000,
  });

  const { result } = await renderSettings();

  await waitFor(() => {
    assert.equal(result.current.claudePermissions.permissionPromptTimeoutMs, 300_000);
  });
});

test('a malformed stored timeout loads as "wait indefinitely"', async () => {
  seedClaudePermissions({ allowedTools: ['Read'], permissionPromptTimeoutMs: '300000' });

  const { result } = await renderSettings();

  await waitFor(() => {
    assert.deepEqual(result.current.claudePermissions.allowedTools, ['Read']);
  });
  assert.equal(result.current.claudePermissions.permissionPromptTimeoutMs, 0);
});

test('choosing a timeout saves it with the rest of the Claude permissions', async () => {
  seedClaudePermissions({ allowedTools: ['Read'], disallowedTools: ['Bash(rm:*)'], skipPermissions: false });

  const { result } = await renderSettings();
  await waitFor(() => {
    assert.deepEqual(result.current.claudePermissions.allowedTools, ['Read']);
  });

  act(() => {
    result.current.setClaudePermissions({ ...result.current.claudePermissions, permissionPromptTimeoutMs: 900_000 });
  });

  await waitFor(() => {
    assert.deepEqual(storedClaudePermissions(), {
      allowedTools: ['Read'],
      disallowedTools: ['Bash(rm:*)'],
      skipPermissions: false,
      permissionPromptTimeoutMs: 900_000,
    });
  }, SAVE_WAIT);
});

test('editing another Claude permission keeps the stored timeout', async () => {
  seedClaudePermissions({
    allowedTools: ['Read'],
    disallowedTools: [],
    skipPermissions: false,
    permissionPromptTimeoutMs: 300_000,
  });

  const { result } = await renderSettings();
  await waitFor(() => {
    assert.deepEqual(result.current.claudePermissions.allowedTools, ['Read']);
  });

  act(() => {
    result.current.setClaudePermissions({ ...result.current.claudePermissions, allowedTools: ['Read', 'Write'] });
  });

  await waitFor(() => {
    assert.deepEqual(storedClaudePermissions()?.allowedTools, ['Read', 'Write']);
  }, SAVE_WAIT);
  assert.equal(storedClaudePermissions()?.permissionPromptTimeoutMs, 300_000);
});
