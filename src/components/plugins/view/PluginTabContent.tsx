import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../../contexts/ThemeContext';
import { authenticatedFetch } from '../../../utils/api';
import { usePlugins } from '../../../contexts/PluginsContext';
import type { Project, ProjectSession } from '../../../types/app';

type PluginTabContentProps = {
  pluginName: string;
  selectedProject: Project | null;
  selectedSession: ProjectSession | null;
};

type PluginContext = {
  theme: 'dark' | 'light';
  // Plugin contract historically used `name` for the project identifier; we
  // keep that key and populate it from the DB `projectId` so external plugins
  // continue to receive a stable opaque id.
  project: { name: string; path: string } | null;
  session: { id: string; title: string } | null;
};

function buildContext(
  isDarkMode: boolean,
  selectedProject: Project | null,
  selectedSession: ProjectSession | null,
): PluginContext {
  return {
    theme: isDarkMode ? 'dark' : 'light',
    project: selectedProject
      ? {
        name: selectedProject.projectId,
        path: selectedProject.fullPath || selectedProject.path || '',
      }
      : null,
    session: selectedSession
      ? {
        id: selectedSession.id,
        title: selectedSession.title || selectedSession.name || selectedSession.id,
      }
      : null,
  };
}

export default function PluginTabContent({
  pluginName,
  selectedProject,
  selectedSession,
}: PluginTabContentProps) {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const { isDarkMode } = useTheme();
  const { plugins } = usePlugins();

  // Stable refs so effects don't need context values in their dep arrays
  const contextRef = useRef<PluginContext>(buildContext(isDarkMode, selectedProject, selectedSession));
  const contextCallbacksRef = useRef<Set<(ctx: PluginContext) => void>>(new Set());

  const moduleRef = useRef<any>(null);

  const plugin = plugins.find(p => p.name === pluginName);

  // Keep contextRef current and notify the mounted plugin on every context change
  useEffect(() => {
    const ctx = buildContext(isDarkMode, selectedProject, selectedSession);
    contextRef.current = ctx;

    for (const cb of contextCallbacksRef.current) {
      try { cb(ctx); } catch { /* plugin error — ignore */ }
    }
  }, [isDarkMode, selectedProject, selectedSession]);

  useEffect(() => {
    // Drop any previous plugin's error before this load attempt starts, so a
    // stale overlay never covers a different (or successfully loaded) plugin.
    setLoadError(null);
    if (!containerRef.current || !plugin?.enabled) return;

    let active = true;
    const container = containerRef.current;
    const entryFile = plugin?.entry ?? 'index.js';
    const contextCallbacks = contextCallbacksRef.current;

    (async () => {
      try {
        // Fetch the plugin JS with auth headers (Cloudflare Worker requires auth on all routes).
        // Then import it via a Blob URL so the browser never makes an unauthenticated request.
        const assetUrl = `/api/plugins/${encodeURIComponent(pluginName)}/assets/${encodeURIComponent(entryFile)}`;
        const res = await authenticatedFetch(assetUrl);
        if (!res.ok) throw new Error(`Failed to fetch plugin (HTTP ${res.status})`);
        const jsText = await res.text();
        const blob = new Blob([jsText], { type: 'application/javascript' });
        const blobUrl = URL.createObjectURL(blob);
        // @vite-ignore
        const mod = await import(/* @vite-ignore */ blobUrl).finally(() => URL.revokeObjectURL(blobUrl));
        if (!active || !containerRef.current) return;

        moduleRef.current = mod;

        const api = {
          get context(): PluginContext { return contextRef.current; },

          onContextChange(cb: (ctx: PluginContext) => void): () => void {
            contextCallbacks.add(cb);
            return () => contextCallbacks.delete(cb);
          },

          async rpc(method: string, path: string, body?: unknown): Promise<unknown> {
            const cleanPath = String(path).replace(/^\//, '');
            const res = await authenticatedFetch(
              `/api/plugins/${encodeURIComponent(pluginName)}/rpc/${cleanPath}`,
              {
                method: method || 'GET',
                ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
              },
            );
            if (!res.ok) throw new Error(`RPC error ${res.status}`);
            return res.json();
          },
        };

        await mod.mount?.(container, api);
        if (!active) {
          try { mod.unmount?.(container); } catch { /* ignore */ }
          moduleRef.current = null;
          return;
        }
      } catch (err) {
        if (!active) return;
        console.error(`[Plugin:${pluginName}] Failed to load:`, err);
        setLoadError(String(err));
      }
    })();

    return () => {
      active = false;
      try { moduleRef.current?.unmount?.(container); } catch { /* ignore */ }
      contextCallbacks.clear();
      moduleRef.current = null;
    };
  }, [pluginName, plugin?.entry, plugin?.enabled]); // re-mount when plugin or enabled state changes

  return (
    <div className="relative h-full w-full overflow-auto">
      <div ref={containerRef} className="h-full w-full overflow-auto" />
      {loadError && (
        <div className="absolute inset-0 p-4 text-[13px] text-red-600">
          {t('common:misc.pluginLoadFailed', { error: loadError })}
        </div>
      )}
    </div>
  );
}
