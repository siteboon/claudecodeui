import fs from 'node:fs';
import path from 'node:path';

import mime from 'mime-types';

import { JWT_SECRET } from '@/modules/auth/index.js';

import { createPluginIdentitySigner } from './plugin-identity.service.js';
import {
  getPluginDir, getPluginsConfig, getPluginsDir, installPluginFromGit,
  resolvePluginAssetPath, savePluginsConfig, scanPlugins, uninstallPlugin, updatePluginFromGit,
} from './plugin-registry.service.js';
import {
  getPluginPort, isPluginRunning, startPluginServer, stopPluginServer,
} from './plugin-process.service.js';
import { createPluginsRouter } from './plugins.routes.js';
import { createPluginsService } from './plugins.service.js';

/**
 * Signs the authenticated user into x-plugin-user-* headers with the plugin's
 * derived key. Shared by the RPC route below and, through the plugins barrel,
 * by the websocket plugin proxy so both transports carry the same identity.
 */
export const buildPluginIdentityHeaders = createPluginIdentitySigner(JWT_SECRET);

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
  signIdentity: buildPluginIdentityHeaders,
  joinPath: path.join,
  logError: (message, error) => console.error(message, error),
});

/** Plugin router assembled with filesystem, loader, and process adapters. */
export const pluginsRoutes = createPluginsRouter(pluginsService);
