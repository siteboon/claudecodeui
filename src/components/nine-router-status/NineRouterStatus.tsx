import { useEffect, useRef, useState } from 'react';

import { useWebSocket } from '../../contexts/WebSocketContext';

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
const PREFERENCE_KEY = 'cloudcli.9router.preferredAccountId';

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

const readStoredPreference = (): string | null => {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(PREFERENCE_KEY);
  } catch {
    return null;
  }
};

const writeStoredPreference = (accountId: string | null): void => {
  if (typeof window === 'undefined') return;
  try {
    if (accountId) {
      window.localStorage.setItem(PREFERENCE_KEY, accountId);
    } else {
      window.localStorage.removeItem(PREFERENCE_KEY);
    }
  } catch {
    /* ignore quota / privacy mode errors */
  }
};

export function NineRouterStatus() {
  const [state, setState] = useState<ConnectionState>('loading');
  const [payload, setPayload] = useState<NineRouterStatusPayload | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(() =>
    readStoredPreference(),
  );
  const restoredRef = useRef(false);
  const { sendMessage } = useWebSocket();

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

  // On first mount, replay the stored preference to the server so the WS session starts
  // with the user's last choice. Runs once (guarded by restoredRef).
  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;
    if (selectedAccountId) {
      sendMessage({ type: 'set-account', accountId: selectedAccountId });
    }
  }, [selectedAccountId, sendMessage]);

  const handleSelect = (accountId: string | null) => {
    setSelectedAccountId(accountId);
    writeStoredPreference(accountId);
    sendMessage({ type: 'set-account', accountId });
    setPickerOpen(false);
  };

  const port = payload?.health?.port ?? 20128;
  const accountCount = payload?.accounts?.length ?? 0;
  const totalRequests = payload?.usage?.totalRequests ?? 0;
  const accounts = payload?.accounts ?? [];
  const canOpenPicker = state === 'connected' && accounts.length > 0;

  return (
    <div className="relative">
      <button
        type="button"
        aria-label="9Router account"
        aria-expanded={pickerOpen}
        aria-haspopup="listbox"
        disabled={!canOpenPicker && state !== 'loading'}
        onClick={() => {
          if (canOpenPicker) setPickerOpen((open) => !open);
        }}
        className="w-full text-left disabled:cursor-default"
      >
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
          {state === 'loading' && (
            <span className="text-gray-500 dark:text-gray-400">checking…</span>
          )}
        </div>
      </button>

      {pickerOpen && canOpenPicker && (
        <ul
          role="listbox"
          aria-label="9Router account selection"
          className="absolute bottom-full left-0 z-50 mb-1 max-h-64 w-full overflow-auto rounded-md border border-gray-200 bg-white p-1 shadow-lg dark:border-gray-700 dark:bg-gray-900"
        >
          <li
            role="option"
            aria-selected={selectedAccountId === null}
            onClick={() => handleSelect(null)}
            className={`cursor-pointer rounded px-2 py-1.5 text-xs transition-colors hover:bg-gray-100 dark:hover:bg-gray-800 ${
              selectedAccountId === null
                ? 'bg-blue-50 font-medium text-blue-700 dark:bg-blue-950 dark:text-blue-400'
                : 'text-gray-700 dark:text-gray-300'
            }`}
          >
            <span className="block">Auto</span>
            <span className="text-[10px] text-gray-500 dark:text-gray-400">
              Round-robin across all accounts
            </span>
          </li>
          {accounts.map((account) => (
            <li
              key={account.id}
              role="option"
              aria-label={account.name}
              aria-selected={selectedAccountId === account.id}
              onClick={() => handleSelect(account.id)}
              className={`cursor-pointer rounded px-2 py-1.5 text-xs transition-colors hover:bg-gray-100 dark:hover:bg-gray-800 ${
                selectedAccountId === account.id
                  ? 'bg-blue-50 font-medium text-blue-700 dark:bg-blue-950 dark:text-blue-400'
                  : 'text-gray-700 dark:text-gray-300'
              }`}
            >
              <span className="block">{account.name}</span>
              <span className="text-[10px] text-gray-500 dark:text-gray-400">
                {account.provider} · {account.testStatus ?? 'unknown'}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
