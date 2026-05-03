/**
 * 9Router integration service.
 *
 * Talks to the 9Router gateway running on localhost (default :20128) and exposes
 * a CloudCLI-shaped view of its connections and usage stats. Designed to be
 * resilient to 9Router being offline — every function returns a sensible empty
 * default rather than throwing, so the UI can render a "9Router not connected"
 * state without try/catch boilerplate at every call site.
 */

export const NINE_ROUTER_DEFAULT_PORT = 20128;

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_FETCH_TIMEOUT_MS = 4000;

export interface NineRouterClientOptions {
  port?: number;
  host?: string;
  timeoutMs?: number;
}

export interface NineRouterHealthResult {
  reachable: boolean;
  port: number;
  status?: string;
  error?: string;
}

export interface NineRouterAccount {
  id: string;
  provider: string;
  name: string;
  active: boolean;
  testStatus?: string;
  priority?: number;
  authType?: string;
}

export interface NineRouterAccountUsage {
  requests: number;
  tokens: number;
  costUsd: number;
}

export interface NineRouterUsage {
  totalRequests: number;
  totalTokens: number;
  totalCostUsd: number;
  perAccount: Record<string, NineRouterAccountUsage>;
}

export type NineRouterUsagePeriod = '24h' | '7d' | '30d' | '60d' | 'all';

export interface NineRouterUsageOptions extends NineRouterClientOptions {
  period?: NineRouterUsagePeriod;
}

const buildBaseUrl = (opts: NineRouterClientOptions = {}): string => {
  const port = opts.port ?? NINE_ROUTER_DEFAULT_PORT;
  const host = opts.host ?? DEFAULT_HOST;
  return `http://${host}:${port}`;
};

const fetchWithTimeout = async (
  url: string,
  opts: NineRouterClientOptions,
): Promise<Response> => {
  const controller = new AbortController();
  const timeoutMs = opts.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
};

export async function check9RouterHealth(
  opts: NineRouterClientOptions = {},
): Promise<NineRouterHealthResult> {
  const port = opts.port ?? NINE_ROUTER_DEFAULT_PORT;
  const url = `${buildBaseUrl(opts)}/api/init`;
  try {
    const response = await fetchWithTimeout(url, opts);
    if (!response.ok) {
      return { reachable: false, port, status: `HTTP ${response.status}` };
    }
    return { reachable: true, port, status: 'ok' };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { reachable: false, port, error: message };
  }
}

interface RawConnection {
  id?: unknown;
  provider?: unknown;
  authType?: unknown;
  name?: unknown;
  priority?: unknown;
  isActive?: unknown;
  testStatus?: unknown;
}

const toAccount = (raw: RawConnection): NineRouterAccount | null => {
  if (typeof raw.id !== 'string' || typeof raw.provider !== 'string') {
    return null;
  }
  return {
    id: raw.id,
    provider: raw.provider,
    name: typeof raw.name === 'string' ? raw.name : raw.id,
    active: raw.isActive === true,
    testStatus: typeof raw.testStatus === 'string' ? raw.testStatus : undefined,
    priority: typeof raw.priority === 'number' ? raw.priority : undefined,
    authType: typeof raw.authType === 'string' ? raw.authType : undefined,
  };
};

export async function get9RouterAccounts(
  opts: NineRouterClientOptions = {},
): Promise<NineRouterAccount[]> {
  const url = `${buildBaseUrl(opts)}/api/providers`;
  try {
    const response = await fetchWithTimeout(url, opts);
    if (!response.ok) {
      return [];
    }
    const body = (await response.json()) as { connections?: unknown };
    if (!Array.isArray(body.connections)) {
      return [];
    }
    return body.connections
      .map((c) => toAccount(c as RawConnection))
      .filter((c): c is NineRouterAccount => c !== null);
  } catch {
    return [];
  }
}

interface RawByAccountEntry {
  requests?: unknown;
  promptTokens?: unknown;
  completionTokens?: unknown;
  cost?: unknown;
}

interface RawUsageStats {
  totalRequests?: unknown;
  totalPromptTokens?: unknown;
  totalCompletionTokens?: unknown;
  totalCost?: unknown;
  byAccount?: unknown;
}

const numberOr = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

const toAccountUsage = (raw: RawByAccountEntry): NineRouterAccountUsage => ({
  requests: numberOr(raw.requests, 0),
  tokens: numberOr(raw.promptTokens, 0) + numberOr(raw.completionTokens, 0),
  costUsd: numberOr(raw.cost, 0),
});

export async function get9RouterUsage(
  opts: NineRouterUsageOptions = {},
): Promise<NineRouterUsage> {
  const period = opts.period ?? '7d';
  const url = `${buildBaseUrl(opts)}/api/usage/stats?period=${encodeURIComponent(period)}`;
  const empty: NineRouterUsage = {
    totalRequests: 0,
    totalTokens: 0,
    totalCostUsd: 0,
    perAccount: {},
  };
  try {
    const response = await fetchWithTimeout(url, opts);
    if (!response.ok) {
      return empty;
    }
    const raw = (await response.json()) as RawUsageStats;
    const totalTokens =
      numberOr(raw.totalPromptTokens, 0) + numberOr(raw.totalCompletionTokens, 0);
    const perAccount: Record<string, NineRouterAccountUsage> = {};
    if (raw.byAccount && typeof raw.byAccount === 'object') {
      for (const [key, value] of Object.entries(raw.byAccount as Record<string, unknown>)) {
        if (value && typeof value === 'object') {
          perAccount[key] = toAccountUsage(value as RawByAccountEntry);
        }
      }
    }
    return {
      totalRequests: numberOr(raw.totalRequests, 0),
      totalTokens,
      totalCostUsd: numberOr(raw.totalCost, 0),
      perAccount,
    };
  } catch {
    return empty;
  }
}
