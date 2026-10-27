import { useEffect, useSyncExternalStore } from 'react';

import { api } from '@/shared/api';
import type { LLMProvider } from '@/shared/types';

/**
 * Chat providers loaded from plugins (`slot: "provider"`), as reported by
 * `GET /api/providers/registry`.
 *
 * The four built-in providers stay hard-coded throughout the UI. Plugin
 * providers are appended to those lists through the helpers below, and every
 * per-provider lookup table falls back to this metadata for ids it does not
 * know. Plugin ids are outside the LLMProvider union, so they are cast at
 * this boundary.
 */
export type PluginProviderInfo = {
  id: LLMProvider;
  pluginName: string;
  pluginIcon: string | null;
  label: string;
  description: string;
  loginCommand: string | null;
  capabilities: {
    permissionModes?: string[];
    supportsMcp?: boolean;
    supportsSkills?: boolean;
    [key: string]: unknown;
  };
  /** The plugin ships its own settings UI, shown as this provider's Permissions panel. */
  settingsPanel?: boolean;
};

const CACHE_KEY = 'cloudcli.pluginProviders';

const readCache = (): PluginProviderInfo[] => {
  try {
    const cached = JSON.parse(window.localStorage.getItem(CACHE_KEY) ?? '[]');
    return Array.isArray(cached) ? cached : [];
  } catch {
    return [];
  }
};

// Seeded from the last load so synchronous readers (the stored provider
// choice) accept a plugin id before the request below has answered.
let pluginProviders: PluginProviderInfo[] = typeof window === 'undefined' ? [] : readCache();
let loadRequest: Promise<void> | null = null;
const listeners = new Set<() => void>();

export function loadPluginProviders(): Promise<void> {
  if (loadRequest) {
    return loadRequest;
  }

  loadRequest = (async () => {
    try {
      const response = await api.providers.registry();
      const body = (await response.json()) as { success?: boolean; data?: { providers?: PluginProviderInfo[] } };
      if (!body.success || !Array.isArray(body.data?.providers)) {
        return;
      }

      pluginProviders = body.data.providers;
      try {
        window.localStorage.setItem(CACHE_KEY, JSON.stringify(pluginProviders));
      } catch {
        // Storage unavailable: the in-memory list still works for this tab.
      }
      listeners.forEach((listener) => listener());
    } catch (error) {
      // A failed load leaves the cached list in place; retried on next use.
      console.error('Error loading plugin providers:', error);
      loadRequest = null;
    }
  })();

  return loadRequest;
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

const getSnapshot = () => pluginProviders;

export function getPluginProviders(): PluginProviderInfo[] {
  return pluginProviders;
}

export function getPluginProvider(id: string | null | undefined): PluginProviderInfo | undefined {
  return id ? pluginProviders.find((provider) => provider.id === id) : undefined;
}

/** Built-in ids followed by the plugin provider ids. */
export function withPluginProviderIds(builtins: readonly LLMProvider[]): LLMProvider[] {
  return [...builtins, ...pluginProviders.map((provider) => provider.id).filter((id) => !builtins.includes(id))];
}

/** Label for a plugin provider id, or `fallback` for anything else. */
export function getPluginProviderLabel<T extends string | undefined>(id: string | null | undefined, fallback: T): string | T {
  return getPluginProvider(id)?.label ?? fallback;
}

/** Re-renders when the plugin provider list changes; triggers the first load. */
export function usePluginProviders(): PluginProviderInfo[] {
  const providers = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  useEffect(() => {
    void loadPluginProviders();
  }, []);

  return providers;
}
