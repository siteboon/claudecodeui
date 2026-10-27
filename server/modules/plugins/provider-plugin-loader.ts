import path from 'node:path';
import { pathToFileURL } from 'node:url';

import Database from 'better-sqlite3';

import { sessionsDb } from '@/modules/database/index.js';
import { notifyRunFailed, notifyRunStopped } from '@/modules/notifications/index.js';
import {
  McpProvider,
  pluginProvidersStore,
  type PluginProviderMeta,
  providerRegistry,
  SkillsProvider,
} from '@/modules/providers/index.js';
import * as imageAttachments from '@/shared/image-attachments.js';
import type { IProvider } from '@/shared/interfaces.js';
import * as utils from '@/shared/utils.js';

import { getPluginsDir, scanPlugins } from './plugin-registry.service.js';

/**
 * What a provider plugin receives from the host. A plugin lives outside this
 * repository and cannot import its `@/...` modules, so the pieces a provider
 * implementation needs are handed over here instead.
 */
export type ProviderPluginHost = {
  pluginName: string;
  pluginDir: string;
  utils: typeof utils;
  attachments: typeof imageAttachments;
  sessionsDb: typeof sessionsDb;
  notifications: {
    notifyRunStopped: typeof notifyRunStopped;
    notifyRunFailed: typeof notifyRunFailed;
  };
  /** The host's better-sqlite3, so plugins need no native build of their own. */
  Database: typeof Database;
  /** Base classes the built-in providers extend for MCP config and SKILL.md handling. */
  bases: {
    McpProvider: typeof McpProvider;
    SkillsProvider: typeof SkillsProvider;
  };
};

export type ProviderPluginModule = {
  default: (host: ProviderPluginHost) => Promise<ProviderPluginExports> | ProviderPluginExports;
};

type ProviderPluginExports = {
  provider: IProvider;
  meta: PluginProviderMeta;
};

/**
 * Loads the chat providers of enabled `slot: "provider"` plugins into the
 * provider registry. Runs in-process (unlike tab plugin servers), because a
 * provider implements IProvider directly. Must run before the session watcher
 * starts so their sessions are indexed and watched.
 *
 * A broken plugin is logged and skipped; it never stops the server.
 */
export async function loadProviderPlugins(): Promise<void> {
  const providerPlugins = scanPlugins().filter((plugin) => plugin.slot === 'provider' && plugin.enabled);

  for (const plugin of providerPlugins) {
    const pluginDir = path.join(getPluginsDir(), plugin.dirName);
    try {
      const entryPath = path.resolve(pluginDir, plugin.provider);
      if (!entryPath.startsWith(pluginDir + path.sep)) {
        throw new Error('provider entry resolves outside the plugin directory');
      }

      const pluginModule = (await import(pathToFileURL(entryPath).href)) as ProviderPluginModule;
      if (typeof pluginModule.default !== 'function') {
        throw new Error('provider entry has no default export factory');
      }

      const { provider, meta } = await pluginModule.default({
        pluginName: plugin.name,
        pluginDir,
        utils,
        attachments: imageAttachments,
        sessionsDb,
        notifications: { notifyRunStopped, notifyRunFailed },
        Database,
        bases: { McpProvider, SkillsProvider },
      });

      if (!provider?.id || !meta?.capabilities) {
        throw new Error('provider factory must return { provider, meta } with provider.id and meta.capabilities');
      }
      if (meta.capabilities.provider !== provider.id) {
        throw new Error(`capabilities.provider "${meta.capabilities.provider}" does not match provider id "${provider.id}"`);
      }
      if (
        typeof provider.id !== 'string'
        || !/^[a-z0-9_-]+$/.test(provider.id)
        || Object.prototype.hasOwnProperty.call(Object.prototype, provider.id)
      ) {
        throw new Error(`invalid provider id "${provider.id}": must be lowercase alphanumeric, dashes or underscores`);
      }
      if (provider.id === 'plain-shell') {
        throw new Error('provider id "plain-shell" is reserved');
      }
      if (providerRegistry.hasProvider(provider.id)) {
        throw new Error(`provider id "${provider.id}" is already registered`);
      }

      pluginProvidersStore.register({
        pluginName: plugin.name,
        pluginIcon: plugin.icon && plugin.icon !== 'Puzzle' ? plugin.icon : null,
        hasSettingsPanel: Boolean(plugin.entry) && plugin.entry !== plugin.provider,
        provider,
        meta,
      });
      console.log(`[Plugins] Loaded provider "${provider.id}" from ${plugin.name}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[Plugins] Failed to load provider plugin ${plugin.name}: ${message}`);
    }
  }
}
