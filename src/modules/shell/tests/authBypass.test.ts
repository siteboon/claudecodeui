import assert from 'node:assert/strict';

import { afterEach, test, vi } from 'vitest';

afterEach(() => {
  localStorage.clear();
  vi.unstubAllEnvs();
});

test('local bypass opens a tokenless shell socket without platform mode', async () => {
  vi.stubEnv('VITE_IS_PLATFORM', 'false');
  vi.stubEnv('VITE_DISABLE_AUTH', 'true');
  vi.resetModules();
  localStorage.clear();
  const { getShellWebSocketUrl } = await import('@/modules/shell/utils/socket');
  const url = getShellWebSocketUrl();
  assert.ok(url);
  assert.equal(new URL(url).pathname, '/shell');
  assert.equal(new URL(url).search, '');
});
