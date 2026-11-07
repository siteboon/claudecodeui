import assert from 'node:assert/strict';

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, test, vi } from 'vitest';

vi.mock('@/modules/onboarding', () => ({ Onboarding: () => <div>onboarding</div> }));

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

test('local bypass opens the workspace and chat socket without local login, onboarding or token refresh', async () => {
  vi.stubEnv('VITE_IS_PLATFORM', 'false');
  vi.stubEnv('VITE_DISABLE_AUTH', 'true');
  vi.resetModules();
  localStorage.clear();
  const requestedPaths: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    requestedPaths.push(url);
    return new Response(JSON.stringify({ preferences: {}, drafts: [] }), { status: 200 });
  }));
  const socketUrls: string[] = [];
  vi.stubGlobal('WebSocket', class {
    static OPEN = 1;
    readyState = 0;
    constructor(url: string) { socketUrls.push(url); }
    close() {}
  });
  const { AuthProvider } = await import('@/modules/auth/context/AuthContext');
  const { default: ProtectedRoute } = await import('@/modules/auth/ProtectedRoute');
  const { WebSocketProvider } = await import('@/shared/context/WebSocketContext');
  render(
    <AuthProvider>
      <ProtectedRoute>
        <WebSocketProvider><div>workspace</div></WebSocketProvider>
      </ProtectedRoute>
    </AuthProvider>,
  );
  await screen.findByText('workspace');
  await waitFor(() => assert.equal(socketUrls.length, 1));
  assert.equal(new URL(socketUrls[0]).pathname, '/ws');
  assert.equal(new URL(socketUrls[0]).search, '');
  assert.equal(requestedPaths.some(url => url.startsWith('/api/auth/') || url.endsWith('/onboarding-status')), false);
});
