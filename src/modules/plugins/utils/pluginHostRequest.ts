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

// Any absolute base works: it exists only so a relative path can be resolved and
// normalised, and the result is compared back against it to catch a path that
// escaped same-origin (`//evil.example/api/x` parses as another host).
const PLUGIN_HOST_BASE = 'https://plugin-host.invalid';

/**
 * Accepts only same-origin, non-traversing paths under `/api/`.
 *
 * Returns the path to use, or `null` if the request must be refused.
 *
 * The checks run on the *pathname* the URL parser produces, not on the raw
 * string: it resolves `..` and its encoded spellings (`%2e%2e`) for us, and a
 * query value is none of our business — `?q=version..next` is an ordinary
 * search, not traversal.
 */
export function normalizePluginHostPath(rawPath: unknown): string | null {
  if (typeof rawPath !== 'string') return null;

  const path = rawPath.trim();
  if (!path.startsWith('/api/')) return null; // rules out schemes, `//host` and relative paths
  if (path.includes('\\')) return null;
  // Whitespace is malformed in a path, but a query value may legitimately hold
  // anything the plugin can encode, so only the part before `?` is checked.
  if (/\s/.test(path.split('?')[0])) return null;

  let url: URL;
  try {
    url = new URL(path, PLUGIN_HOST_BASE);
  } catch {
    return null; // malformed URL or percent-encoding
  }

  if (url.origin !== PLUGIN_HOST_BASE) return null;

  let decodedPathname = url.pathname;
  try {
    decodedPathname = decodeURIComponent(url.pathname);
  } catch {
    return null; // malformed percent-encoding
  }

  if (decodedPathname.includes('..') || decodedPathname.includes('\\')) return null;
  if (!decodedPathname.startsWith('/api/')) return null;

  return `${url.pathname}${url.search}`;
}

/**
 * What the host hands to `authenticatedFetch`: headers stay a plain record
 * rather than the wider `HeadersInit`, which is the shape that client accepts.
 */
export type PluginHostRequestInit = Omit<RequestInit, 'headers'> & {
  headers: Record<string, string>;
};

/**
 * Forces GET and drops any `Authorization` the caller tried to set: the host
 * attaches its own credentials, and a plugin can neither read nor forge them.
 */
export function buildPluginHostRequestInit(init?: PluginHostFetchInit): PluginHostRequestInit {
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
