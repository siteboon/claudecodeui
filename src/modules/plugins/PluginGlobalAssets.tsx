import { useEffect } from 'react';

import { usePlugins } from '@/modules/plugins/context/PluginsContext';
import { callPluginRpc, fetchPluginAssetText, importPluginModule } from '@/modules/plugins/utils/pluginAssetLoading';

type PluginGlobalAssetsLoaderProps = {
  pluginName: string;
  scripts: string[];
  styles: string[];
};

/**
 * Loads one plugin's global styles and scripts, and takes them back out on
 * unmount. The parent keys this component by everything it loads plus the
 * plugin's update count, so a disable, an uninstall or an update unmounts it
 * and the cleanup below is the whole of "unload" — no reload of the page.
 */
function PluginGlobalAssetsLoader({ pluginName, scripts, styles }: PluginGlobalAssetsLoaderProps) {
  useEffect(() => {
    let active = true;
    const styleElements: HTMLStyleElement[] = [];
    const scriptCleanups: Array<() => void> = [];
    const hostApi = {
      rpc: (method: string, path: string, body?: unknown) => callPluginRpc(pluginName, method, path, body),
    };

    // Each asset loads on its own, so one broken file does not keep the rest
    // of the plugin, or any other plugin, from loading. Styles go first and in
    // declared order, so scripts start against the plugin's own CSS.
    (async () => {
      for (const stylePath of styles) {
        try {
          const css = await fetchPluginAssetText(pluginName, stylePath);
          if (!active) return;
          const element = document.createElement('style');
          element.dataset.plugin = pluginName;
          element.dataset.pluginAsset = stylePath;
          element.textContent = css;
          document.head.appendChild(element);
          styleElements.push(element);
        } catch (err) {
          console.error(`[Plugin:${pluginName}] Failed to load style ${stylePath}:`, err);
        }
      }

      for (const scriptPath of scripts) {
        try {
          const mod = await importPluginModule(pluginName, scriptPath);
          if (!active) return;
          const cleanup = await mod.start?.(hostApi);
          if (typeof cleanup !== 'function') continue;
          // Unmounted while start() was still running: undo it right away.
          if (!active) {
            cleanup();
            return;
          }
          scriptCleanups.push(cleanup);
        } catch (err) {
          console.error(`[Plugin:${pluginName}] Failed to load script ${scriptPath}:`, err);
        }
      }
    })();

    return () => {
      active = false;
      // Scripts stop in reverse order of starting, before their styles go.
      for (const cleanup of scriptCleanups.reverse()) {
        try { cleanup(); } catch (err) { console.error(`[Plugin:${pluginName}] Cleanup failed:`, err); }
      }
      for (const element of styleElements) element.remove();
    };
    // The parent's key covers pluginName, scripts and styles; the arrays get a
    // new identity on every plugin list refresh, which must not reload them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}

/**
 * Rendered by App inside the auth gate, so it runs once per page after login.
 * Loads the `scripts` and `styles` every enabled plugin declares in its
 * manifest, independently of whether the plugin's tab is ever opened.
 */
export default function PluginGlobalAssets() {
  const { plugins, pluginsError, refreshPlugins, pluginUpdateRevisions } = usePlugins();

  // PluginsProvider sits outside the auth gate and fetches once on mount; on a
  // fresh login that fetch was refused, so the list is fetched again here.
  useEffect(() => {
    if (pluginsError) void refreshPlugins();
    // Only the state at mount matters: retrying on every later error would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      {plugins
        .filter((plugin) => plugin.enabled && (plugin.scripts?.length || plugin.styles?.length))
        .map((plugin) => (
          <PluginGlobalAssetsLoader
            key={JSON.stringify([
              plugin.name,
              plugin.version,
              plugin.scripts,
              plugin.styles,
              pluginUpdateRevisions[plugin.name] ?? 0,
            ])}
            pluginName={plugin.name}
            scripts={plugin.scripts ?? []}
            styles={plugin.styles ?? []}
          />
        ))}
    </>
  );
}
