import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { authenticatedFetch, extractResponseError } from '@/shared/api';

import { api } from '@/shared/api';
import type { Plugin } from '@/shared/types';


type PluginsContextValue = {
  plugins: Plugin[];
  loading: boolean;
  pluginsError: string | null;
  refreshPlugins: () => Promise<void>;
  installPlugin: (url: string) => Promise<{ success: boolean; error?: string }>;
  uninstallPlugin: (name: string) => Promise<{ success: boolean; error?: string }>;
  updatePlugin: (name: string) => Promise<{ success: boolean; error?: string }>;
  togglePlugin: (name: string, enabled: boolean) => Promise<{ success: boolean; error: string | null }>;
};

const PluginsContext = createContext<PluginsContextValue | null>(null);

export function usePlugins() {
  const context = useContext(PluginsContext);
  if (!context) {
    throw new Error('usePlugins must be used within a PluginsProvider');
  }
  return context;
}

/** Mounted by the app root so the plugins and project-workspace modules can read and mutate installed plugins through usePlugins. */
export function PluginsProvider({ children }: { children: ReactNode }) {
  const [plugins, setPlugins] = useState<Plugin[]>([]);
  const [loading, setLoading] = useState(true);
  const [pluginsError, setPluginsError] = useState<string | null>(null);

  const refreshPlugins = useCallback(async () => {
    try {
      const res = await api.plugins.list();
      if (res.ok) {
        const data = await res.json();
        setPlugins(data.plugins || []);
        setPluginsError(null);
      } else {
        const errorMessage = await extractResponseError(res, 'Failed to fetch plugins');
        setPluginsError(errorMessage);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch plugins';
      setPluginsError(message);
      console.error('[Plugins] Failed to fetch plugins:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshPlugins();
  }, [refreshPlugins]);

  const installPlugin = useCallback(async (url: string) => {
    try {
      const res = await authenticatedFetch('/api/plugins/install', {
        method: 'POST',
        body: JSON.stringify({ url }),
      });
      if (res.ok) {
        await refreshPlugins();
        return { success: true };
      }
      const error = await extractResponseError(res, 'Install failed');
      return { success: false, error };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Install failed' };
    }
  }, [refreshPlugins]);

  const uninstallPlugin = useCallback(async (name: string) => {
    try {
      const res = await authenticatedFetch(`/api/plugins/${encodeURIComponent(name)}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        await refreshPlugins();
        return { success: true };
      }
      const error = await extractResponseError(res, 'Uninstall failed');
      return { success: false, error };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Uninstall failed' };
    }
  }, [refreshPlugins]);

  const updatePlugin = useCallback(async (name: string) => {
    try {
      const res = await authenticatedFetch(`/api/plugins/${encodeURIComponent(name)}/update`, {
        method: 'POST',
      });
      if (res.ok) {
        await refreshPlugins();
        return { success: true };
      }
      const error = await extractResponseError(res, 'Update failed');
      return { success: false, error };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Update failed' };
    }
  }, [refreshPlugins]);

  const togglePlugin = useCallback(async (name: string, enabled: boolean): Promise<{ success: boolean; error: string | null }> => {
    try {
      const res = await api.plugins.toggle(name, enabled);
      if (!res.ok) {
        const error = await extractResponseError(res, 'Toggle failed');
        return { success: false, error };
      }
      await refreshPlugins();
      return { success: true, error: null };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Toggle failed' };
    }
  }, [refreshPlugins]);

  // Built once per change: an inline object would re-render every consumer on
  // any render of this provider.
  const value = useMemo(
    () => ({ plugins, loading, pluginsError, refreshPlugins, installPlugin, uninstallPlugin, updatePlugin, togglePlugin }),
    [installPlugin, loading, plugins, pluginsError, refreshPlugins, togglePlugin, uninstallPlugin, updatePlugin],
  );

  return (
    <PluginsContext.Provider value={value}>
      {children}
    </PluginsContext.Provider>
  );
}
