import assert from 'node:assert/strict';

import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { useEffect, useState } from 'react';
import { afterEach, beforeEach, test, vi } from 'vitest';

import { AuthProvider, useAuth } from '@/modules/auth/context/AuthContext';
import '@/modules/i18n';
import { hydrateEnabledProviders, readEnabledProviders } from '@/shared/enabledProviders';
import { readSelectedProvider } from '@/shared/selectedProvider';
import { readUserPreference, resetUserPreferences } from '@/shared/userSettings';

/**
 * VITE_ENABLED_PROVIDERS (#349) reaches the UI through GET
 * /api/providers/enabled. The app must not be shown before that answer is in,
 * or the provider picker would paint a disabled provider and then pull it.
 * Once the user's own preferences arrive, a stored provider the server no
 * longer enables is rewritten so the copy in auth.db agrees.
 */

const ALL_PROVIDERS = ['claude', 'codex', 'cursor', 'opencode'];

let serverProviders: string[] = ALL_PROVIDERS;
let storedServerProvider: string | null = null;
let savedPreferences: Array<Record<string, unknown>> = [];
let preferencesDelayMs = 0;

const stubServer = () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/providers/enabled') {
      // Slower than everything else in the bootstrap, so an app that does not
      // wait for it would render first.
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
    if (url === '/api/user/preferences' && init?.method !== 'PATCH' && preferencesDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, preferencesDelayMs));
    }
    if (url === '/api/user/preferences' && init?.method === 'PATCH') {
      savedPreferences.push(JSON.parse(String(init.body)) as Record<string, unknown>);
    }
    const body = url === '/api/auth/status'
      ? { needsSetup: false }
      : url === '/api/auth/user'
        ? { user: { id: 1, username: 'triage' } }
        : url === '/api/user/onboarding-status'
          ? { hasCompletedOnboarding: true }
          : url === '/api/providers/enabled'
            ? { success: true, data: { providers: serverProviders } }
            : url === '/api/user/preferences'
              ? { preferences: storedServerProvider ? { selectedProvider: storedServerProvider } : {} }
              : {};
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }));
};

// What the app saw the first time it was shown.
let firstPaint: { enabled: readonly string[]; selected: string } | null = null;

function Workspace() {
  const [seen] = useState(() => ({ enabled: readEnabledProviders(), selected: readSelectedProvider() }));
  useEffect(() => {
    firstPaint ??= seen;
  }, [seen]);
  return <div>workspace</div>;
}

function Gate() {
  const { isLoading, user } = useAuth();
  if (isLoading) {
    return <div>loading</div>;
  }
  return user ? <Workspace /> : <div>login</div>;
}

beforeEach(async () => {
  localStorage.clear();
  resetUserPreferences();
  savedPreferences = [];
  storedServerProvider = null;
  preferencesDelayMs = 0;
  firstPaint = null;
  stubServer();
  // The store is a module singleton: put it back to "every provider" first.
  serverProviders = ALL_PROVIDERS;
  await hydrateEnabledProviders();
  localStorage.setItem('auth-token', 'stored-token');
});

afterEach(() => {
  cleanup();
  resetUserPreferences();
  vi.unstubAllGlobals();
});

test('the app is first shown with the server list and its default provider already applied', async () => {
  serverProviders = ['codex', 'claude'];

  render(<AuthProvider><Gate /></AuthProvider>);
  await screen.findByText('workspace');

  assert.deepEqual(firstPaint, { enabled: ['codex', 'claude'], selected: 'codex' });
});

// The two requests race: the preferences may land before or after the list.
for (const [order, delayMs] of [['before', 0], ['after', 100]] as const) {
  test(`a stored provider the server disabled is rewritten when the preferences load ${order} the list`, async () => {
    serverProviders = ['claude'];
    storedServerProvider = 'cursor';
    preferencesDelayMs = delayMs;

    render(<AuthProvider><Gate /></AuthProvider>);
    await screen.findByText('workspace');

    await waitFor(() => {
      assert.equal(readUserPreference('selectedProvider', null), 'claude');
    });
    // ...and the rewrite reaches the server, past the preference store's debounce.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 500));
    });
    assert.ok(savedPreferences.some((update) => update.selectedProvider === 'claude'));
  });
}
