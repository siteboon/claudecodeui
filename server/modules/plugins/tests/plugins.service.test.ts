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

test('update restarts a running plugin server when the update fails', async () => {
  const operations: string[] = [];
  let running = true;
  const service = createPluginsService(dependencies({
    scanPlugins: () => [{ name: 'demo', dirName: 'demo', server: 'server.js' }],
    getPluginDirectory: () => '/plugins/demo',
    isServerRunning: () => running,
    stopServer: async () => { operations.push('stop'); running = false; },
    update: async () => { operations.push('pull'); throw new Error('git pull failed'); },
    startServer: async () => { operations.push('start'); running = true; return 4000; },
  }));
  await assert.rejects(service.update('demo'), /git pull failed/);
  assert.deepEqual(operations, ['stop', 'pull', 'start']);
});

test('a failed update does not start a plugin server that was not running', async () => {
  const operations: string[] = [];
  const service = createPluginsService(dependencies({
    scanPlugins: () => [{ name: 'demo', dirName: 'demo', server: 'server.js' }],
    getPluginDirectory: () => '/plugins/demo',
    update: async () => { operations.push('pull'); throw new Error('git pull failed'); },
    startServer: async () => { operations.push('start'); return 4000; },
  }));
  await assert.rejects(service.update('demo'), /git pull failed/);
  assert.deepEqual(operations, ['pull']);
});

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
