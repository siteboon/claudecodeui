import assert from 'node:assert/strict';
import test from 'node:test';

import { browserUseService, isBlockedBrowserUseAddress } from '@/modules/browser-use/browser-use.service.js';

test('browser use blocks private and local network addresses by default', () => {
  assert.equal(isBlockedBrowserUseAddress('127.0.0.1'), true);
  assert.equal(isBlockedBrowserUseAddress('10.0.0.12'), true);
  assert.equal(isBlockedBrowserUseAddress('172.16.4.8'), true);
  assert.equal(isBlockedBrowserUseAddress('192.168.1.4'), true);
  assert.equal(isBlockedBrowserUseAddress('169.254.169.254'), true);
  assert.equal(isBlockedBrowserUseAddress('::1'), true);
  assert.equal(isBlockedBrowserUseAddress('8.8.8.8'), false);
  assert.equal(isBlockedBrowserUseAddress('2001:4860:4860::8888'), false);
});

test('browser use monitor list starts empty without agent sessions', async () => {
  const sessions = await browserUseService.listSessions();

  assert.deepEqual(sessions, []);
});
