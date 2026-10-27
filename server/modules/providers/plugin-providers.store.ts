import type { IProvider } from '@/shared/interfaces.js';
import type { AnyRecord } from '@/shared/types.js';

/**
 * Capability description a plugin provider supplies about itself. Same shape
 * as the built-in capability matrix in provider-capabilities.service.ts.
 */
export type PluginProviderCapabilities = {
  provider: string;
  permissionModes: string[];
  permissionModeOptions?: Record<string, { label: string; description: string }>;
  defaultPermissionMode: string;
  supportsImages: boolean;
  supportsFiles: boolean;
  supportsAbort: boolean;
  supportsPermissionRequests: boolean;
  supportsTokenUsage: boolean;
  supportsEffort: boolean;
  effortLevels: string[];
  supportsMessageEditing: boolean;
  supportsSessionForking: boolean;
  /** Not part of the built-in matrix: lets the UI hide settings panels a plugin does not implement. */
  supportsMcp?: boolean;
  supportsSkills?: boolean;
  /** Install location shown in the skills panel, e.g. `~/.foo/skills/<skill-name>/SKILL.md`. */
  skillsPath?: string;
};

/**
 * Everything the core needs to know about a provider that is not on IProvider
 * itself. Built-in providers keep this knowledge hard-coded across the server
 * and the UI; plugin providers hand it over once, at load time.
 */
export type PluginProviderMeta = {
  label: string;
  /** Short vendor line shown under the label in the provider picker. */
  description?: string;
  /** Command run in the login terminal (Settings > Agents > Account). */
  loginCommand?: string;
  capabilities: PluginProviderCapabilities;
  /** Directories whose changes should trigger `sessionSynchronizer.synchronizeFile`. */
  watchRoots?: string[];
  /** Filters watcher events below `watchRoots`; every file is accepted when omitted. */
  isWatchTarget?: (filePath: string) => boolean;
  /** Shell tab command; `resumeSessionId` is the provider-native id when resuming. */
  shellCommand?: (options: { resumeSessionId: string | null; projectPath: string }) => string;
  /** Token usage for the token budget endpoint; `null` reports "unsupported". */
  getTokenUsage?: (providerSessionId: string) => Promise<AnyRecord | null> | AnyRecord | null;
  /** The CLI's own updater, offered in Settings > Agents; without it the CLI counts as not updatable here. */
  cliUpdater?: { command: string; args: string[] };
};

export type PluginProviderEntry = {
  /** Name of the plugin that registered the provider. */
  pluginName: string;
  /** The plugin's manifest icon (an SVG asset path), used as the provider logo. */
  pluginIcon: string | null;
  /**
   * Whether the plugin ships its own settings UI: a manifest `entry` (mounted
   * like a tab plugin, with its `server` for RPC) other than the provider
   * module. Shown as the provider's Permissions panel in Settings > Agents.
   */
  hasSettingsPanel: boolean;
  provider: IProvider;
  meta: PluginProviderMeta;
};

/**
 * Process-wide store of providers loaded from plugins.
 *
 * Deliberately dependency-free (type imports only) so the provider registry,
 * the capability matrix and the session watcher can all read it without
 * creating an import cycle.
 */
const pluginProviders = new Map<string, PluginProviderEntry>();

export const pluginProvidersStore = {
  register(entry: PluginProviderEntry): void {
    pluginProviders.set(entry.provider.id, entry);
  },

  get(providerId: string): PluginProviderEntry | undefined {
    return pluginProviders.get(providerId);
  },

  list(): PluginProviderEntry[] {
    return Array.from(pluginProviders.values());
  },
};
