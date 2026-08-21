/**
 * Pure rules behind `api.host`: what a plugin is allowed to request, and the
 * shape of the api object handed to it. Kept free of imports with side effects
 * so it stays directly testable.
 */

/** Bumped when the shape of `api.host` changes; plugins feature-detect first, this is a tiebreaker. */
export const PLUGIN_HOST_API_VERSION = 1;

export type PluginHostFetchInit = {
  headers?: Record<string, string>;
  signal?: AbortSignal;
};

export type PluginHostApi = {
  /** Authenticated, read-only access to the host's own REST API. */
  fetch: (path: string, init?: PluginHostFetchInit) => Promise<Response>;
  /** Navigation intents — these have no HTTP equivalent in the host. */
  startNewSession: (projectId: string) => void;
  openSession: (projectId: string, sessionId: string) => void;
};

export type PluginContext = {
  theme: 'dark' | 'light';
  project: { name: string; path: string } | null;
  session: { id: string; title: string } | null;
};

export type PluginApi = {
  readonly context: PluginContext;
  onContextChange: (callback: (context: PluginContext) => void) => () => void;
  rpc: (method: string, path: string, body?: unknown) => Promise<unknown>;
  readonly hostApiVersion: typeof PLUGIN_HOST_API_VERSION;
  readonly host: PluginHostApi;
  readonly surface: 'tab' | 'sidebar';
};

/**
 * Accepts only same-origin, non-traversing paths under `/api/`.
 *
 * Returns the path to use, or `null` if the request must be refused. Encoded
 * traversal is caught by decoding first: `/api/%2e%2e/secret` is `/api/../secret`.
 */
export function normalizePluginHostPath(rawPath: unknown): string | null {
  if (typeof rawPath !== 'string') return null;

  const path = rawPath.trim();
  if (!path.startsWith('/api/')) return null; // rules out schemes, `//host` and relative paths
  if (path.includes('\\') || /\s/.test(path)) return null;

  let decoded = path;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    return null; // malformed percent-encoding
  }

  if (decoded.includes('..') || decoded.includes('\\') || !decoded.startsWith('/api/')) return null;

  return path;
}

/**
 * Forces GET and drops any `Authorization` the caller tried to set: the host
 * attaches its own credentials, and a plugin can neither read nor forge them.
 */
export function buildPluginHostRequestInit(init?: PluginHostFetchInit): RequestInit {
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(init?.headers ?? {})) {
    if (name.toLowerCase() === 'authorization') continue;
    headers[name] = value;
  }

  return {
    method: 'GET',
    headers,
    ...(init?.signal ? { signal: init.signal } : {}),
  };
}

/**
 * Builds the object handed to a plugin module's `mount()`.
 *
 * `context` and `host` are getters so a module that captured the api object once
 * still observes the current values; the pre-existing members keep their exact
 * shape, so plugins unaware of `host` behave as before.
 */
export function createPluginApi(sources: {
  getContext: () => PluginContext;
  onContextChange: (callback: (context: PluginContext) => void) => () => void;
  rpc: (method: string, path: string, body?: unknown) => Promise<unknown>;
  getHost: () => PluginHostApi;
  surface?: 'tab' | 'sidebar';
}): PluginApi {
  return {
    get context() { return sources.getContext(); },
    onContextChange: sources.onContextChange,
    rpc: sources.rpc,
    hostApiVersion: PLUGIN_HOST_API_VERSION,
    get host() { return sources.getHost(); },
    surface: sources.surface ?? 'tab',
  };
}
