import { useMemo, useState } from 'react';
import { Keyboard, RefreshCw, Settings } from 'lucide-react';

import { Tooltip } from '../../../../shared/view/ui';
import {
  useProviderUsage,
  type ProviderUsageSnapshot,
  type UsageWindow,
} from '../../../../hooks/useProviderUsage';

import { MOD_KEY } from './shortcuts';

type SidebarFooterV4Props = {
  onShowSettings: () => void;
  onShowShortcuts: () => void;
  onRefresh: () => void;
  isRefreshing: boolean;
};

type ProviderId = 'claude' | 'codex';

const PROVIDER_DOT_COLOR: Record<ProviderId, string> = {
  claude: '#d97706',
  codex: '#22c55e',
};

const PROVIDER_LABEL: Record<ProviderId, string> = {
  claude: 'Claude',
  codex: 'Codex',
};

export default function SidebarFooterV4({
  onShowSettings,
  onShowShortcuts,
  onRefresh,
  isRefreshing,
}: SidebarFooterV4Props) {
  const claude = useProviderUsage('claude');
  const codex = useProviderUsage('codex');

  const [hoveredProvider, setHoveredProvider] = useState<ProviderId | null>(null);
  const [pinnedProvider, setPinnedProviderState] = useState<ProviderId>(() => {
    const stored = typeof window !== 'undefined' ? localStorage.getItem('selected-provider') : null;
    return stored === 'codex' ? 'codex' : 'claude';
  });

  const codexAvailable =
    !!codex.snapshot && codex.snapshot.method !== null;

  const effectivePinned: ProviderId =
    pinnedProvider === 'codex' && !codexAvailable ? 'claude' : pinnedProvider;

  const activeProvider: ProviderId =
    hoveredProvider && (hoveredProvider === 'claude' || codexAvailable)
      ? hoveredProvider
      : effectivePinned;
  const activeSnapshot = activeProvider === 'claude' ? claude.snapshot : codex.snapshot;
  const otherProvider: ProviderId = effectivePinned === 'claude' ? 'codex' : 'claude';
  const otherAvailable = otherProvider === 'codex' ? codexAvailable : true;

  const setPinnedProvider = (next: ProviderId) => {
    setPinnedProviderState(next);
    setHoveredProvider(null);
    if (typeof window !== 'undefined') {
      localStorage.setItem('selected-provider', next);
      window.dispatchEvent(new CustomEvent('selected-provider-changed', { detail: next }));
    }
  };

  const handleRefreshAll = () => {
    onRefresh();
    claude.refresh();
    if (codexAvailable) codex.refresh();
  };

  return (
    <div className="flex flex-col gap-1.5 border-t border-border/60 px-3 py-2">
      <div className="flex items-center gap-2">
        <span
          aria-hidden
          className="h-1.5 w-1.5 flex-shrink-0 rounded-full"
          style={{ background: PROVIDER_DOT_COLOR[activeProvider] }}
        />
        <IdentityLabel snapshot={activeSnapshot} />
        <Tooltip content="Refresh projects & usage" position="top">
          <button
            onClick={handleRefreshAll}
            disabled={isRefreshing}
            className="flex rounded p-1 text-muted-foreground transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60"
            aria-label="Refresh projects"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
          </button>
        </Tooltip>
        <Tooltip content={`Keyboard shortcuts (${MOD_KEY}K for palette)`} position="top">
          <button
            onClick={onShowShortcuts}
            className="flex rounded p-1 text-muted-foreground transition-colors hover:text-foreground"
            aria-label="Keyboard shortcuts"
          >
            <Keyboard className="h-3.5 w-3.5" />
          </button>
        </Tooltip>
        <Tooltip content="Settings" position="top">
          <button
            onClick={onShowSettings}
            className="flex rounded p-1 text-muted-foreground transition-colors hover:text-foreground"
            aria-label="Settings"
          >
            <Settings className="h-3.5 w-3.5" />
          </button>
        </Tooltip>
      </div>
      <div className="flex items-center gap-2">
        {otherAvailable && (
          <ProviderPill
            provider={otherProvider}
            onEnter={() => setHoveredProvider(otherProvider)}
            onLeave={() => setHoveredProvider(null)}
            onClick={() => setPinnedProvider(otherProvider)}
          />
        )}
        <UsageRow snapshot={activeSnapshot} />
      </div>
    </div>
  );
}

function IdentityLabel({ snapshot }: { snapshot: ProviderUsageSnapshot | null }) {
  if (!snapshot) {
    return (
      <span className="flex-1 truncate text-xs font-medium text-muted-foreground/70">
        Loading…
      </span>
    );
  }

  if (snapshot.method === 'api_key') {
    return (
      <span className="flex-1 truncate text-xs font-medium text-muted-foreground/80">
        {PROVIDER_LABEL[snapshot.provider]} · API key
      </span>
    );
  }

  const label = snapshot.email ?? snapshot.displayName ?? 'Signed out';
  return (
    <span
      className="flex-1 truncate text-xs font-medium text-muted-foreground"
      title={label}
    >
      {label}
    </span>
  );
}

function UsageRow({ snapshot }: { snapshot: ProviderUsageSnapshot | null }) {
  if (!snapshot || snapshot.method === null) {
    return (
      <div className="flex flex-1 items-center gap-2 text-[10px] text-muted-foreground/50">
        {snapshot?.error ?? (snapshot === null ? 'Loading usage…' : 'Not authenticated')}
      </div>
    );
  }

  if (snapshot.method === 'api_key') {
    return (
      <div className="flex flex-1 items-center gap-2 text-[10px] uppercase tracking-wider text-muted-foreground/50">
        Usage bars unavailable on API key
      </div>
    );
  }

  return (
    <div className="flex flex-1 items-center gap-3">
      <UsageBar label="5hr" window={snapshot.fiveHour} windowSec={5 * 60 * 60} />
      <UsageBar label="week" window={snapshot.sevenDay} windowSec={7 * 24 * 60 * 60} />
    </div>
  );
}

type PaceInfo =
  | { kind: 'exhaust'; seconds: number }
  | { kind: 'reset'; seconds: number }
  | { kind: 'resetting' };

function computePace(utilization: number, resetsAt: number, windowSec: number): PaceInfo {
  const now = Math.floor(Date.now() / 1000);
  const timeToReset = resetsAt - now;
  if (timeToReset <= 0) return { kind: 'resetting' };
  const elapsed = windowSec - timeToReset;
  if (elapsed <= 0 || utilization <= 0) return { kind: 'reset', seconds: timeToReset };
  const rate = utilization / elapsed;
  const timeToExhaust = (1 - utilization) / rate;
  if (timeToExhaust < timeToReset) {
    return { kind: 'exhaust', seconds: Math.round(timeToExhaust) };
  }
  return { kind: 'reset', seconds: timeToReset };
}

function UsageBar({
  label,
  window,
  windowSec,
}: {
  label: string;
  window: UsageWindow;
  windowSec: number;
}) {
  const utilization = window ? Math.max(0, Math.min(1, window.utilization)) : null;
  const pct = utilization === null ? 0 : Math.round(utilization * 100);

  const fillColor = useMemo(() => {
    if (utilization === null) return 'var(--muted-foreground)';
    if (utilization >= 0.9) return '#ef4444';
    if (utilization >= 0.75) return '#f59e0b';
    return 'var(--project-accent)';
  }, [utilization]);

  const pace = useMemo(() => {
    if (utilization === null || !window) return null;
    return computePace(utilization, window.resetsAt, windowSec);
  }, [utilization, window, windowSec]);

  const paceText = pace
    ? pace.kind === 'resetting'
      ? 'resetting'
      : `${pace.kind === 'exhaust' ? '~' : ''}${formatShortDuration(pace.seconds)}`
    : '';
  const paceColor =
    pace?.kind === 'exhaust'
      ? utilization !== null && utilization >= 0.75
        ? 'text-red-500'
        : 'text-amber-500'
      : 'text-muted-foreground/60';

  const tooltip =
    utilization === null
      ? `${label} · data unavailable`
      : `${label} · ${pct}%${
          pace?.kind === 'exhaust'
            ? ` · projected to run out in ${formatShortDuration(pace.seconds)} (reset in ${formatShortDuration(
                (window?.resetsAt ?? 0) - Math.floor(Date.now() / 1000),
              )})`
            : window
              ? ` · ${formatReset(window.resetsAt)}`
              : ''
        }`;

  return (
    <div className="flex flex-1 flex-col gap-0.5" title={tooltip}>
      <div className="flex items-center gap-2">
        <span className="text-[9px] uppercase tracking-wider text-muted-foreground/70">
          {label}
        </span>
        <span className={`flex-1 text-center text-[9px] tabular-nums ${paceColor}`}>
          {paceText}
        </span>
        {utilization !== null && (
          <span className="text-[9px] tabular-nums text-muted-foreground/70">{pct}%</span>
        )}
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full transition-[width,background-color] duration-300"
          style={{
            width: `${utilization === null ? 0 : pct}%`,
            background: fillColor,
          }}
        />
      </div>
    </div>
  );
}

function formatShortDuration(seconds: number): string {
  if (seconds <= 0) return '0m';
  if (seconds < 60) return '<1m';
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function ProviderPill({
  provider,
  onEnter,
  onLeave,
  onClick,
}: {
  provider: ProviderId;
  onEnter: () => void;
  onLeave: () => void;
  onClick: () => void;
}) {
  return (
    <Tooltip content={`Switch to ${PROVIDER_LABEL[provider]} (default for new sessions)`} position="top">
      <button
        type="button"
        onMouseEnter={onEnter}
        onMouseLeave={onLeave}
        onFocus={onEnter}
        onBlur={onLeave}
        onClick={onClick}
        className="flex h-5 items-center gap-1 rounded-full border border-border/60 bg-background/40 px-1.5 text-[9px] uppercase tracking-wider text-muted-foreground transition-colors hover:border-border hover:text-foreground"
        aria-label={`Switch default to ${PROVIDER_LABEL[provider]}`}
      >
        <span
          aria-hidden
          className="h-1.5 w-1.5 rounded-full"
          style={{ background: PROVIDER_DOT_COLOR[provider] }}
        />
        <span>{PROVIDER_LABEL[provider]}</span>
      </button>
    </Tooltip>
  );
}

/**
 * Formats a unix-seconds reset timestamp as "resets in 2h 14m" / "resets in 3d 4h".
 * Returns "resetting" once the value is in the past.
 */
function formatReset(resetsAt: number): string {
  const deltaSeconds = resetsAt - Math.floor(Date.now() / 1000);
  if (deltaSeconds <= 0) return 'resetting';
  const days = Math.floor(deltaSeconds / 86400);
  const hours = Math.floor((deltaSeconds % 86400) / 3600);
  const minutes = Math.floor((deltaSeconds % 3600) / 60);
  if (days > 0) return `resets in ${days}d ${hours}h`;
  if (hours > 0) return `resets in ${hours}h ${minutes}m`;
  return `resets in ${minutes}m`;
}
