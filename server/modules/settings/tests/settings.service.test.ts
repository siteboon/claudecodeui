import assert from 'node:assert/strict';
import test from 'node:test';

import { createSettingsService } from '../settings.service.js';

type Dependencies = Parameters<typeof createSettingsService>[0];

function dependencies(overrides: Partial<Dependencies> = {}): Dependencies {
  return {
    apiKeys: { list: () => [], create: () => ({}), remove: () => false, toggle: () => false },
    credentials: { list: () => [], create: () => ({}), remove: () => false, toggle: () => false },
    notifications: {
      getPreferences: () => undefined,
      updatePreferences: () => ({}),
      createEnabledEvent: () => ({}),
      notifyUser: () => undefined,
    },
    pushSubscriptions: { save: () => undefined, remove: () => undefined },
    mcpDisabledServers: {
      get: () => [],
      set: (_userId, value) => (Array.isArray(value) ? value.map(String) : []),
    },
    getVapidPublicKey: () => null,
    ...overrides,
  };
}

test('listApiKeys redacts secret values through the service boundary', () => {
  const service = createSettingsService(dependencies({
    apiKeys: {
      list: () => [{ id: 1, api_key: '1234567890-secret' }],
      create: () => ({}), remove: () => false, toggle: () => false,
    },
  }));
  assert.equal(service.listApiKeys(1).apiKeys[0]?.api_key, '1234567890...');
});

test('subscribeToPush persists the subscription and enables Web Push', () => {
  const operations: string[] = [];
  const service = createSettingsService(dependencies({
    pushSubscriptions: {
      save: (_id, endpoint) => operations.push(`save:${endpoint}`),
      remove: () => undefined,
    },
    notifications: {
      getPreferences: () => ({ channels: { webPush: false } }),
      updatePreferences: () => { operations.push('preferences'); return {}; },
      createEnabledEvent: () => ({ code: 'push.enabled' }),
      notifyUser: () => { operations.push('notify'); },
    },
  }));

  service.subscribeToPush(1, {
    endpoint: 'https://push.example.test',
    keys: { p256dh: 'key', auth: 'auth' },
  });
  assert.deepEqual(operations, ['save:https://push.example.test', 'preferences', 'notify']);
});

test('mcp-disabled-servers round-trips through the injected repository', () => {
  const operations: string[] = [];
  const service = createSettingsService(dependencies({
    mcpDisabledServers: {
      get: (userId) => { operations.push(`get:${userId}`); return ['github']; },
      set: (userId, value) => { operations.push(`set:${userId}`); return Array.isArray(value) ? value.map(String) : []; },
    },
  }));

  assert.deepEqual(service.getMcpDisabledServers(7), { success: true, servers: ['github'] });
  assert.deepEqual(service.updateMcpDisabledServers(7, ['fetch', 'github']), {
    success: true,
    servers: ['fetch', 'github'],
  });
  assert.deepEqual(operations, ['get:7', 'set:7']);
});
