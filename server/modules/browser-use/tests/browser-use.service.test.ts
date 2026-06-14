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

test('browser use sessions are listed only for their owner', async () => {
  const originalEnabled = process.env.CLOUDCLI_BROWSER_USE_ENABLED;
  process.env.CLOUDCLI_BROWSER_USE_ENABLED = '0';

  const ownerA = { id: `owner-a-${Date.now()}-${Math.random()}` };
  const ownerB = { id: `owner-b-${Date.now()}-${Math.random()}` };

  try {
    const ownerASession = await browserUseService.createSession(ownerA);
    await browserUseService.createSession(ownerB);

    const ownerASessions = await browserUseService.listSessions(ownerA);
    const ownerBSessions = await browserUseService.listSessions(ownerB);

    assert.equal(ownerASessions.some((session) => session.id === ownerASession.id), true);
    assert.equal(ownerBSessions.some((session) => session.id === ownerASession.id), false);
    assert.equal(Object.hasOwn(ownerASession, 'ownerId'), false);
  } finally {
    if (originalEnabled === undefined) {
      delete process.env.CLOUDCLI_BROWSER_USE_ENABLED;
    } else {
      process.env.CLOUDCLI_BROWSER_USE_ENABLED = originalEnabled;
    }
  }
});
