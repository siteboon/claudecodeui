import { api } from '@/shared/api';

/** Used by the plugin tab and the global asset loader to read a plugin file as text through the authenticated assets route. */
export async function fetchPluginAssetText(pluginName: string, assetPath: string): Promise<string> {
  const res = await api.plugins.asset(pluginName, assetPath);
  if (!res.ok) throw new Error(`Failed to fetch plugin asset ${assetPath} (HTTP ${res.status})`);
  return res.text();
}

/**
 * Used by the plugin tab and the global asset loader to import a plugin module.
 * The file is fetched with auth headers and imported from a Blob URL, so the
 * browser never makes an unauthenticated request for it (a Cloudflare Worker in
 * front of the app requires auth on every route).
 */
export async function importPluginModule(pluginName: string, assetPath: string): Promise<any> {
  const jsText = await fetchPluginAssetText(pluginName, assetPath);
  const blob = new Blob([jsText], { type: 'application/javascript' });
  const blobUrl = URL.createObjectURL(blob);
  return import(/* @vite-ignore */ blobUrl).finally(() => URL.revokeObjectURL(blobUrl));
}

/** Used by the plugin tab and the global asset loader as the `rpc` they hand to plugin code, proxied to the plugin's own server. */
export async function callPluginRpc(pluginName: string, method: string, path: string, body?: unknown): Promise<unknown> {
  const res = await api.plugins.rpc(pluginName, method, path, body);
  if (!res.ok) throw new Error(`RPC error ${res.status}`);
  return res.json();
}
