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
  /**
   * `projectId` is reserved: the host navigates by session id alone and does
   * not check that the session belongs to that project. Pass it for forward
   * compatibility, but do not read it as a validated pairing.
   */
  openSession: (projectId: string, sessionId: string) => void;
};

export type PluginContext = {
  theme: 'dark' | 'light';
  // The plugin contract historically used `name` for the project identifier; the
  // key stays, populated from the DB `projectId`, so external plugins keep
  // receiving a stable opaque id.
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

/** A body on these is a protocol error, so `Response` refuses to carry one. */
const NULL_BODY_STATUSES = new Set([101, 204, 205, 304]);

/**
 * Headers the host consumes itself and a plugin must never observe.
 *
 * `authenticatedFetch` stores a rotated token and reacts to an auth error before
 * it resolves, so by the time a response reaches the plugin these carry nothing
 * the host still needs — only a bearer token the plugin could pocket.
 */
const HOST_CREDENTIAL_HEADERS = ['X-Refreshed-Token', 'X-Auth-Error'];

/** Copies a response without the host's credential headers; status and body pass through. */
export function withoutHostCredentialHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const name of HOST_CREDENTIAL_HEADERS) headers.delete(name);

  const body = NULL_BODY_STATUSES.has(response.status) ? null : response.body;
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
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
