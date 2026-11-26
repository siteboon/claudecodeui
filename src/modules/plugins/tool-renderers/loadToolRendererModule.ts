import { api } from '@/shared/api';

/** What a plugin module exports to render chat rows for the tools its manifest lists in `toolRenderers`. */
export type PluginToolRendererModule = {
  renderTool?: (
    container: HTMLElement,
    context: PluginToolContext,
    host: PluginToolHostApi,
  ) => PluginToolHandle | void | Promise<PluginToolHandle | void>;
};

export type PluginToolContext = {
  toolName: string;
  toolId: string | null;
  toolInput: unknown;
  toolResult: { content: unknown; isError: boolean } | null;
  status: 'running' | 'completed' | 'error' | 'denied';
  theme: 'dark' | 'light';
  project: { name: string; path: string } | null;
  /** App session id of the conversation this row belongs to. */
  sessionId: string | null;
};

export type PluginToolHostApi = {
  rpc(method: string, path: string, body?: unknown): Promise<unknown>;
  /** Opens another session in the app, e.g. a session the tool started. */
  openSession(sessionId: string): void;
  /** Archives the project at `projectPath` (hidden, sessions kept and restorable), as the sidebar does. */
  archiveProject(projectPath: string): Promise<{ ok: true } | { ok: false; error: string }>;
  /** Deletes the project at `projectPath` with its sessions and transcripts, as the sidebar's delete does. */
  deleteProject(projectPath: string): Promise<{ ok: true } | { ok: false; error: string }>;
  /** Archives one session (hidden, restorable), as the sidebar's session archive does. */
  archiveSession(sessionId: string): Promise<{ ok: true } | { ok: false; error: string }>;
  /** Deletes one session and its transcript, as the sidebar's session delete does. */
  deleteSession(sessionId: string): Promise<{ ok: true } | { ok: false; error: string }>;
};

export type PluginToolHandle = {
  update?: (context: PluginToolContext) => void;
  destroy?: () => void;
};

// One module instance per plugin for every tool row it renders, loaded the way the tab slot loads it:
// fetched with auth headers, then imported from a Blob URL.
const modules = new Map<string, Promise<PluginToolRendererModule>>();

export function loadToolRendererModule(pluginName: string, entry: string): Promise<PluginToolRendererModule> {
  const key = `${pluginName}:${entry}`;
  let pending = modules.get(key);
  if (!pending) {
    pending = (async () => {
      const res = await api.plugins.asset(pluginName, entry);
      if (!res.ok) throw new Error(`Failed to fetch plugin (HTTP ${res.status})`);
      const blobUrl = URL.createObjectURL(new Blob([await res.text()], { type: 'application/javascript' }));
      try {
        return (await import(/* @vite-ignore */ blobUrl)) as PluginToolRendererModule;
      } finally {
        URL.revokeObjectURL(blobUrl);
      }
    })();
    pending.catch(() => modules.delete(key)); // let a later row retry after a failure
    modules.set(key, pending);
  }
  return pending;
}
