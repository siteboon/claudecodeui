import assert from 'node:assert/strict';
import test from 'node:test';

import { createPluginsService } from '../plugins.service.js';

type Dependencies = Parameters<typeof createPluginsService>[0];

function dependencies(overrides: Partial<Dependencies> = {}): Dependencies {
  return {
    scanPlugins: () => [], readConfig: () => ({}), saveConfig: () => undefined,
    getPluginDirectory: () => null, getPluginsDirectory: () => '/plugins',
    resolveAsset: () => null, assetIsFile: () => false, contentType: () => 'text/plain',
    install: async () => ({ name: 'plugin', dirName: 'plugin' }),
    update: async () => ({ name: 'plugin', dirName: 'plugin' }),
    uninstall: async () => undefined, startServer: async () => 4000,
    stopServer: async () => undefined, getServerPort: () => undefined,
    isServerRunning: () => false, signIdentity: () => ({}),
    joinPath: (...parts) => parts.join('/'),
    logError: () => undefined, ...overrides,
  };
}

test('setEnabled persists configuration and starts an enabled plugin server', async () => {
  const operations: string[] = [];
  const service = createPluginsService(dependencies({
    scanPlugins: () => [{ name: 'demo', dirName: 'demo', server: { entry: 'server.js' } }],
    getPluginDirectory: () => '/plugins/demo',
    saveConfig: () => operations.push('save'),
    startServer: async () => { operations.push('start'); return 4000; },
  }));
  await service.setEnabled('demo', true);
  assert.deepEqual(operations, ['save', 'start']);
});

test('prepareRpc returns identity headers for an authenticated user', async () => {
  const signed: unknown[] = [];
  const service = createPluginsService(dependencies({
    getServerPort: () => 4000,
    readConfig: () => ({ demo: { secrets: { token: 'abc' } } }),
    signIdentity: (pluginName, user) => {
      signed.push([pluginName, user]);
      return { 'x-plugin-user-payload': `signed-for-${String(user?.id)}` };
    },
  }));
  const result = await service.prepareRpc('demo', { id: 7, username: 'triage' });
  assert.deepEqual(signed, [['demo', { id: 7, username: 'triage' }]]);
  assert.deepEqual(result, {
    port: 4000,
    secrets: { token: 'abc' },
    identityHeaders: { 'x-plugin-user-payload': 'signed-for-7' },
  });
});

test('prepareRpc returns no identity headers without a user', async () => {
  const service = createPluginsService(dependencies({
    getServerPort: () => 4000,
    signIdentity: (_pluginName, user) => {
      assert.equal(user, undefined);
      return {};
    },
  }));
  const result = await service.prepareRpc('demo');
  assert.deepEqual(result.identityHeaders, {});
});
