import { api } from '@/shared/api';

/** Where the host mounted a plugin: inside its workspace tab, or in the always-on resident layer. */
export type PluginSurface = 'tab' | 'resident';

/**
 * The host surface handed to a plugin module. Both surfaces publish a context of
 * this shape and talk to the host the same way; only `surface` differs, so one
 * plugin bundle can serve either or both.
 */
export type PluginHostApi<TContext> = {
  readonly context: TContext;
  onContextChange(callback: (context: TContext) => void): () => void;
  rpc(method: string, path: string, body?: unknown): Promise<unknown>;
};

/**
 * Fetches a plugin bundle and imports it as an ES module.
 *
 * The fetch carries auth headers and the text is imported from a blob URL, so
 * the browser never makes an unauthenticated request for a plugin asset.
 *
 * The return type is `unknown` on purpose: a third-party bundle is untrusted
 * code, and each surface narrows the module to the shape it actually calls.
 */
export async function loadPluginModule(pluginName: string, entryFile: string): Promise<unknown> {
  const response = await api.plugins.asset(pluginName, entryFile);
  if (!response.ok) throw new Error(`Failed to fetch plugin (HTTP ${response.status})`);

  const jsText = await response.text();
  const blobUrl = URL.createObjectURL(new Blob([jsText], { type: 'application/javascript' }));
  return import(/* @vite-ignore */ blobUrl).finally(() => URL.revokeObjectURL(blobUrl));
}

/**
 * Builds the host API both surfaces pass to `mount()`.
 *
 * `subscribe` receives the callback and returns its unsubscribe function, which
 * leaves ownership of the callback set with the caller that also clears it.
 */
export function createPluginHostApi<TContext>(
  pluginName: string,
  readContext: () => TContext,
  subscribe: (callback: (context: TContext) => void) => () => void,
): PluginHostApi<TContext> {
  return {
    get context(): TContext { return readContext(); },

    onContextChange(callback: (context: TContext) => void): () => void {
      return subscribe(callback);
    },

    async rpc(method: string, path: string, body?: unknown): Promise<unknown> {
      const response = await api.plugins.rpc(pluginName, method, path, body);
      if (!response.ok) throw new Error(`RPC error ${response.status}`);
      return response.json();
    },
  };
}
