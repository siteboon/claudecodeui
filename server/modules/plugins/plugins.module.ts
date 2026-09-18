import fs from 'node:fs';
import path from 'node:path';

import mime from 'mime-types';

import {
  getPluginDir, getPluginsConfig, getPluginsDir, installPluginFromGit,
  resolvePluginAssetPath, savePluginsConfig, scanPlugins, uninstallPlugin, updatePluginFromGit,
} from './plugin-registry.service.js';
import {
  getPluginPort, isPluginRunning, startPluginServer, stopPluginServer,
} from './plugin-process.service.js';
import { createPluginsRouter } from './plugins.routes.js';
import { createPluginsService } from './plugins.service.js';

const pluginsService = createPluginsService({
  scanPlugins, readConfig: getPluginsConfig, saveConfig: savePluginsConfig,
  getPluginDirectory: getPluginDir, getPluginsDirectory: getPluginsDir,
  resolveAsset: resolvePluginAssetPath,
  assetIsFile: (assetPath) => { try { return fs.statSync(assetPath).isFile(); } catch { return false; } },
  contentType: (assetPath) => mime.lookup(assetPath) || 'application/octet-stream',
  install: installPluginFromGit,
  update: updatePluginFromGit,
  uninstall: async (pluginName) => { await uninstallPlugin(pluginName); },
  startServer: startPluginServer,
  stopServer: async (pluginName) => { await stopPluginServer(pluginName); },
  getServerPort: getPluginPort, isServerRunning: isPluginRunning,
  joinPath: path.join,
  logError: (message, error) => console.error(message, error),
});

/** Plugin router assembled with filesystem, loader, and process adapters. */
export const pluginsRoutes = createPluginsRouter(pluginsService);
