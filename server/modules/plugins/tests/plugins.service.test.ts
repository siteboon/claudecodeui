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
    isServerRunning: () => false, joinPath: (...parts) => parts.join('/'),
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

test('update() restarts the running plugin server when the update is rejected', async () => {
  const operations: string[] = [];
  const runningFlags = [true, false];
  let isRunningIndex = 0;
  const service = createPluginsService(dependencies({
    scanPlugins: () => [{ name: 'demo', dirName: 'demo', server: { entry: 'server.js' } }],
    getPluginDirectory: () => '/plugins/demo',
    startServer: async () => { operations.push('start'); return 4000; },
    stopServer: async () => { operations.push('stop'); },
    isServerRunning: () => runningFlags[isRunningIndex++] === true,
    update: async () => {
      throw new Error('build script rejected');
    },
  }));

  await assert.rejects(
    service.update('demo'),
    (error: unknown) => error instanceof Error && /build script rejected/.test(error.message),
  );

  // The previously running plugin server must be brought back online after a
  // rejected update — leaving it stopped would silently break the plugin.
  assert.deepEqual(operations, ['stop', 'start']);
});
