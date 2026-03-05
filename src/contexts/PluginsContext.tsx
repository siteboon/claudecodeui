import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { authenticatedFetch } from '../utils/api';

export type Plugin = {
  name: string;
  displayName: string;
  version: string;
  description: string;
  author: string;
  icon: string;
  type: 'iframe' | 'react' | 'module';
  slot: 'tab';
  entry: string;
  server: string | null;
  permissions: string[];
  enabled: boolean;
  serverRunning: boolean;
  dirName: string;
};

type PluginsContextValue = {
  plugins: Plugin[];
  loading: boolean;
  refreshPlugins: () => Promise<void>;
  installPlugin: (url: string) => Promise<{ success: boolean; error?: string }>;
  uninstallPlugin: (name: string) => Promise<{ success: boolean; error?: string }>;
  updatePlugin: (name: string) => Promise<{ success: boolean; error?: string }>;
  togglePlugin: (name: string, enabled: boolean) => Promise<void>;
};

const PluginsContext = createContext<PluginsContextValue | null>(null);

export function usePlugins() {
  const context = useContext(PluginsContext);
  if (!context) {
    throw new Error('usePlugins must be used within a PluginsProvider');
  }
  return context;
}

export function PluginsProvider({ children }: { children: ReactNode }) {
  const [plugins, setPlugins] = useState<Plugin[]>([]);
  const [loading, setLoading] = useState(true);

  const refreshPlugins = useCallback(async () => {
    try {
      const res = await authenticatedFetch('/api/plugins');
      if (res.ok) {
        const data = await res.json();
        setPlugins(data.plugins || []);
      }
    } catch (err) {
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
      const data = await res.json();
      if (res.ok) {
        await refreshPlugins();
        return { success: true };
      }
      return { success: false, error: data.details || data.error || 'Install failed' };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Install failed' };
    }
  }, [refreshPlugins]);

  const uninstallPlugin = useCallback(async (name: string) => {
    try {
      const res = await authenticatedFetch(`/api/plugins/${encodeURIComponent(name)}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (res.ok) {
        await refreshPlugins();
        return { success: true };
      }
      return { success: false, error: data.details || data.error || 'Uninstall failed' };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Uninstall failed' };
    }
  }, [refreshPlugins]);

  const updatePlugin = useCallback(async (name: string) => {
    try {
      const res = await authenticatedFetch(`/api/plugins/${encodeURIComponent(name)}/update`, {
        method: 'POST',
      });
      const data = await res.json();
      if (res.ok) {
        await refreshPlugins();
        return { success: true };
      }
      return { success: false, error: data.details || data.error || 'Update failed' };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Update failed' };
    }
  }, [refreshPlugins]);

  const togglePlugin = useCallback(async (name: string, enabled: boolean) => {
    try {
      await authenticatedFetch(`/api/plugins/${encodeURIComponent(name)}/enable`, {
        method: 'PUT',
        body: JSON.stringify({ enabled }),
      });
      await refreshPlugins();
    } catch (err) {
      console.error('[Plugins] Failed to toggle plugin:', err);
    }
  }, [refreshPlugins]);

  return (
    <PluginsContext.Provider value={{ plugins, loading, refreshPlugins, installPlugin, uninstallPlugin, updatePlugin, togglePlugin }}>
      {children}
    </PluginsContext.Provider>
  );
}
