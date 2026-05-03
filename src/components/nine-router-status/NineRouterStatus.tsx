import { useEffect, useState } from 'react';

interface NineRouterAccount {
  id: string;
  provider: string;
  name: string;
  active: boolean;
  testStatus?: string;
}

interface NineRouterUsage {
  totalRequests: number;
  totalTokens: number;
  totalCostUsd: number;
}

interface NineRouterHealth {
  reachable: boolean;
  port: number;
  status?: string;
  error?: string;
}

interface NineRouterStatusPayload {
  health: NineRouterHealth;
  accounts: NineRouterAccount[];
  usage: NineRouterUsage;
}

type ConnectionState = 'loading' | 'connected' | 'disconnected';

const STATUS_ENDPOINT = '/api/9router/status';

const baseClasses =
  'flex items-center gap-2 rounded-md px-2 py-1 text-xs font-medium transition-colors';

const stateClasses: Record<ConnectionState, string> = {
  loading: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
  connected: 'bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-400',
  disconnected: 'bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-400',
};

const dotClasses: Record<ConnectionState, string> = {
  loading: 'bg-gray-400 animate-pulse',
  connected: 'bg-green-500',
  disconnected: 'bg-red-500',
};

export function NineRouterStatus() {
  const [state, setState] = useState<ConnectionState>('loading');
  const [payload, setPayload] = useState<NineRouterStatusPayload | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    const fetchStatus = async () => {
      try {
        const response = await fetch(STATUS_ENDPOINT, { signal: controller.signal });
        if (!response.ok) {
          setState('disconnected');
          setPayload(null);
          return;
        }
        const data = (await response.json()) as NineRouterStatusPayload;
        setPayload(data);
        setState(data.health?.reachable ? 'connected' : 'disconnected');
      } catch (error) {
        if ((error as { name?: string })?.name === 'AbortError') return;
        setState('disconnected');
        setPayload(null);
      }
    };

    void fetchStatus();

    return () => {
      controller.abort();
    };
  }, []);

  const port = payload?.health?.port ?? 20128;
  const accountCount = payload?.accounts?.length ?? 0;
  const totalRequests = payload?.usage?.totalRequests ?? 0;

  return (
    <div
      role="status"
      data-state={state}
      className={`${baseClasses} ${stateClasses[state]}`}
      title={state === 'disconnected' ? payload?.health?.error : undefined}
    >
      <span className={`h-2 w-2 rounded-full ${dotClasses[state]}`} aria-hidden />
      <span>9Router</span>
      {state === 'connected' && (
        <>
          <span className="text-gray-500 dark:text-gray-400">:{port}</span>
          <span className="text-gray-400 dark:text-gray-600">·</span>
          <span data-testid="nine-router-account-count">{accountCount}</span>
          <span className="text-gray-400 dark:text-gray-600">accounts ·</span>
          <span data-testid="nine-router-usage-requests">{totalRequests}</span>
          <span className="text-gray-400 dark:text-gray-600">req/24h</span>
        </>
      )}
      {state === 'disconnected' && <span>not connected</span>}
      {state === 'loading' && <span className="text-gray-500 dark:text-gray-400">checking…</span>}
    </div>
  );
}
