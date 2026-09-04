import assert from 'node:assert/strict';
import test from 'node:test';

import { browserUseService } from '@/modules/browser-use/browser-use.service.js';

test('browser monitor list starts empty without agent sessions', async () => {
  const sessions = await browserUseService.listSessions();

  assert.deepEqual(sessions, []);
});

test('syncAgentMcpIfNeeded reconciles only when enabled in settings and is idempotent', async () => {
  const initialSettings = await browserUseService.getSettings();

  try {
    // Disabled state
    await browserUseService.updateSettings({ enabled: false });
    const disabledResult = await browserUseService.syncAgentMcpIfNeeded();
    assert.deepEqual(disabledResult, { synced: false, reason: 'disabled' });

    // Enabled state
    await browserUseService.updateSettings({ enabled: true });
    const tokenBefore = browserUseService.getMcpToken();
    const enabledResult1 = await browserUseService.syncAgentMcpIfNeeded();
    assert.equal(enabledResult1.synced, true);
    assert.equal(enabledResult1.registration?.name, 'cloudcli-browser');
    assert.ok(Array.isArray(enabledResult1.registration?.results));

    // Idempotent secondary call
    const enabledResult2 = await browserUseService.syncAgentMcpIfNeeded();
    assert.equal(enabledResult2.synced, true);
    assert.equal(enabledResult2.registration?.name, 'cloudcli-browser');
    assert.equal(browserUseService.getMcpToken(), tokenBefore);
  } finally {
    await browserUseService.updateSettings(initialSettings);
  }
});
