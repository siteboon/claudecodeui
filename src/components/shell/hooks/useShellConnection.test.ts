import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { applyShellAuthRefresh } from '../utils/socket';

if (!globalThis.localStorage) {
  const storage = new Map<string, string>();
  globalThis.localStorage = {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => {
      storage.set(key, String(value));
    },
    removeItem: (key: string) => {
      storage.delete(key);
    },
    clear: () => {
      storage.clear();
    },
    key: (index: number) => Array.from(storage.keys())[index] ?? null,
    get length() {
      return storage.size;
    },
  };
}

test('shell socket close does not clear terminal output during reconnect', async () => {
  const source = await readFile(new URL('./useShellConnection.ts', import.meta.url), 'utf8');
  const onCloseBlock = source.match(/socket\.onclose = \(\) => \{[\s\S]*?\n\s*\};/)?.[0] ?? '';

  assert.notEqual(onCloseBlock, '');
  assert.equal(onCloseBlock.includes('clearTerminalScreen'), false);
});

test('shell auth_refresh message updates the stored websocket token', () => {
  const previousToken = localStorage.getItem('auth-token');
  try {
    localStorage.setItem('auth-token', 'old-token');

    const handled = applyShellAuthRefresh({ type: 'auth_refresh', token: 'new-token' });

    assert.equal(handled, true);
    assert.equal(localStorage.getItem('auth-token'), 'new-token');
  } finally {
    if (previousToken === null) {
      localStorage.removeItem('auth-token');
    } else {
      localStorage.setItem('auth-token', previousToken);
    }
  }
});
