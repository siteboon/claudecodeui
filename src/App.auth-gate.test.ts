import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('auth-gated providers do not mount before ProtectedRoute allows the app', async () => {
  const source = await readFile(new URL('./App.tsx', import.meta.url), 'utf8');
  const protectedRouteIndex = source.indexOf('<ProtectedRoute>');

  assert.notEqual(protectedRouteIndex, -1);
  for (const provider of ['<WebSocketProvider>', '<PluginsProvider>', '<TasksSettingsProvider>', '<TaskMasterProvider>']) {
    assert.ok(source.indexOf(provider) > protectedRouteIndex, `${provider} should be inside ProtectedRoute`);
  }
});
