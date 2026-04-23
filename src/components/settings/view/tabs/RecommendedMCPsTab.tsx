import { useCallback, useEffect, useState } from 'react';

import { ExternalLink, RefreshCw, Server, Star } from 'lucide-react';

import { authenticatedFetch } from '../../../../utils/api';

interface RecommendedMCP {
  name: string;
  displayName: string;
  description: string;
  repoUrl: string;
  stars: string;
  installed: boolean;
  userDismissed: boolean;
  installedByDispatch: boolean;
}

async function fetchRecommended(): Promise<RecommendedMCP[]> {
  const response = await authenticatedFetch('/api/mcp-bootstrap/recommended');
  if (!response.ok) {
    throw new Error(`Failed to load recommended MCPs (${response.status})`);
  }
  const payload = await response.json();
  return Array.isArray(payload?.items) ? payload.items : [];
}

async function toggleRecommended(name: string, enabled: boolean): Promise<RecommendedMCP[]> {
  const response = await authenticatedFetch(`/api/mcp-bootstrap/recommended/${encodeURIComponent(name)}/toggle`, {
    method: 'POST',
    body: JSON.stringify({ enabled }),
  });
  if (!response.ok) {
    throw new Error(`Failed to toggle ${name} (${response.status})`);
  }
  const payload = await response.json();
  return Array.isArray(payload?.items) ? payload.items : [];
}

function Toggle({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-11 min-h-[44px] w-[52px] min-w-[52px] flex-shrink-0 items-center rounded-full border border-border/60 touch-manipulation transition-colors ${
        checked ? 'bg-primary' : 'bg-muted'
      } disabled:opacity-50`}
    >
      <span
        className={`inline-block h-7 w-7 transform rounded-full bg-background shadow transition-transform ${
          checked ? 'translate-x-[22px]' : 'translate-x-1'
        }`}
      />
    </button>
  );
}

export default function RecommendedMCPsTab() {
  const [items, setItems] = useState<RecommendedMCP[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyName, setBusyName] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const next = await fetchRecommended();
      setItems(next);
    } catch (err) {
      setLoadError((err as Error).message || 'Failed to load');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const handleToggle = useCallback(
    async (mcp: RecommendedMCP, enabled: boolean) => {
      setBusyName(mcp.name);
      setActionError(null);
      try {
        const next = await toggleRecommended(mcp.name, enabled);
        setItems(next);
      } catch (err) {
        setActionError((err as Error).message || 'Toggle failed');
      } finally {
        setBusyName(null);
      }
    },
    [],
  );

  return (
    <div className="space-y-4" data-accent="lavender">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <Server className="mt-0.5 h-5 w-5 flex-shrink-0 text-primary" />
          <div>
            <h3 className="text-lg font-medium text-foreground">Recommended MCP Servers</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Dispatch ships with two recommended MCP servers enabled by default. Toggle them off here to remove
              them from <code className="rounded bg-muted px-1 text-xs">~/.claude.json</code>.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void reload()}
          disabled={isLoading}
          className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg border border-border px-3 text-xs font-medium text-muted-foreground hover:bg-accent/40 hover:text-foreground disabled:opacity-50"
          aria-label="Reload"
        >
          <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {loadError && (
        <div
          className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          role="alert"
        >
          {loadError}
        </div>
      )}

      {actionError && (
        <div
          className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          role="alert"
        >
          {actionError}
        </div>
      )}

      {isLoading && items.length === 0 && (
        <div className="py-8 text-center text-sm text-muted-foreground">Loading recommended MCPs…</div>
      )}

      {!isLoading && items.length === 0 && !loadError && (
        <div className="py-8 text-center text-sm text-muted-foreground">No recommended MCPs configured.</div>
      )}

      <div className="space-y-3">
        {items.map((mcp) => {
          const isBusy = busyName === mcp.name;
          const isEnabled = mcp.installed && !mcp.userDismissed;
          return (
            <div
              key={mcp.name}
              className="ds-tile rounded-lg border border-border bg-card/50 p-4"
            >
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-foreground">{mcp.displayName}</span>
                    <code className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">{mcp.name}</code>
                    <span className="inline-flex items-center gap-1 rounded-full bg-muted/70 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                      <Star className="h-3 w-3" />
                      {mcp.stars}
                    </span>
                    {mcp.installed && (
                      <span className="ds-chip ds-chip-mint h-6 px-2 text-[11px]">Installed</span>
                    )}
                    {mcp.userDismissed && !mcp.installed && (
                      <span className="ds-chip ds-chip-blush h-6 px-2 text-[11px]">Dismissed</span>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground">{mcp.description}</p>
                  <a
                    href={mcp.repoUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                  >
                    View on GitHub
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
                <div className="flex flex-shrink-0 items-center gap-3">
                  <Toggle
                    checked={isEnabled}
                    onChange={(next) => void handleToggle(mcp, next)}
                    disabled={isBusy}
                    label={`Toggle ${mcp.displayName}`}
                  />
                  <span className="text-xs text-muted-foreground">{isEnabled ? 'On' : 'Off'}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="rounded-lg border border-border/60 bg-muted/30 p-4 text-xs text-muted-foreground">
        Toggles write directly to <code className="rounded bg-muted px-1">~/.claude.json</code> and
        remember dismissals so the bootstrap won&apos;t re-install a server you&apos;ve turned off.
      </div>
    </div>
  );
}
