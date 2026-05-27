import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { BarChart2, RefreshCw, X } from 'lucide-react';
import { authenticatedFetch } from '../../../../utils/api';

type Bucket = {
  label: string;
  pct: number | null;
  reset_in?: string | null;
};

type UsageData = {
  plan?: string | null;
  session?: Bucket | null;
  weekly?: Bucket[];
  error?: string | null;
};

type ContextUsagePillProps = {
  used: number;
  total: number;
  provider: string;
  onOpenSettings?: () => void;
};

const REFRESH_MS = 5 * 60 * 1000;

function pctColor(pct: number): string {
  if (pct < 50) return 'text-blue-500 dark:text-blue-400';
  if (pct < 75) return 'text-amber-500 dark:text-amber-400';
  return 'text-red-500 dark:text-red-400';
}

function ProgressBar({ pct, className = '' }: { pct: number; className?: string }) {
  const fill =
    pct < 50 ? 'bg-blue-500 dark:bg-blue-400'
    : pct < 75 ? 'bg-amber-500 dark:bg-amber-400'
    : 'bg-red-500 dark:bg-red-400';
  return (
    <div className={`h-1.5 w-full overflow-hidden rounded-full bg-muted ${className}`}>
      <div
        className={`h-full rounded-full transition-all ${fill}`}
        style={{ width: `${Math.min(100, pct)}%` }}
      />
    </div>
  );
}

export default function ContextUsagePill({ used, total, provider, onOpenSettings }: ContextUsagePillProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [hoverTimer, setHoverTimer] = useState<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const [popupStyle, setPopupStyle] = useState<CSSProperties | null>(null);

  // Usage data state
  const [hasKey, setHasKey] = useState<boolean | null>(null);
  const [usageData, setUsageData] = useState<UsageData | null>(null);
  const [loadingUsage, setLoadingUsage] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const ctxPct = total > 0 ? Math.min(100, (used / total) * 100) : 0;
  const sessionPct = usageData?.session?.pct ?? null;

  useEffect(() => {
    if (provider !== 'claude') return;
    authenticatedFetch('/api/user/claude-session-key')
      .then((r) => r.json() as Promise<{ success: boolean; hasKey: boolean }>)
      .then((b) => { if (b.success) setHasKey(b.hasKey); })
      .catch(() => setHasKey(false));
  }, [provider]);

  const fetchUsage = useCallback(async (force = false) => {
    if (provider !== 'claude') return;
    setLoadingUsage(true);
    try {
      const url = force ? '/api/usage/claude?refresh=1' : '/api/usage/claude';
      const res = await authenticatedFetch(url);
      const body = await res.json() as { success: boolean; hasSessionKey: boolean; data: UsageData | null };
      if (body.success) {
        setHasKey(body.hasSessionKey);
        if (body.hasSessionKey && body.data) setUsageData(body.data);
      }
    } catch {
      // silent
    } finally {
      setLoadingUsage(false);
    }
  }, [provider]);

  useEffect(() => {
    if (!hasKey) return;
    void fetchUsage();
    intervalRef.current = setInterval(() => void fetchUsage(), REFRESH_MS);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [hasKey, fetchUsage]);

  const updatePopupPosition = useCallback(() => {
    const trigger = triggerRef.current;
    const popup = popupRef.current;
    if (!trigger || !popup || typeof window === 'undefined') return;

    const rect = trigger.getBoundingClientRect();
    const pad = 12;
    const width = 260;
    const measuredH = popup.offsetHeight || 240;
    const spaceAbove = rect.top - pad;
    const openAbove = spaceAbove >= measuredH;

    let left = rect.left + rect.width / 2 - width / 2;
    left = Math.max(pad, Math.min(left, window.innerWidth - width - pad));

    const top = openAbove
      ? rect.top - measuredH - 8
      : rect.bottom + 8;

    setPopupStyle({ position: 'fixed', top, left, width, zIndex: 80 });
  }, []);

  useEffect(() => {
    if (!isOpen) { setPopupStyle(null); return; }
    const id = requestAnimationFrame(updatePopupPosition);
    window.addEventListener('resize', updatePopupPosition);
    window.addEventListener('scroll', updatePopupPosition, true);
    return () => {
      cancelAnimationFrame(id);
      window.removeEventListener('resize', updatePopupPosition);
      window.removeEventListener('scroll', updatePopupPosition, true);
    };
  }, [isOpen, updatePopupPosition]);

  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: PointerEvent) => {
      const t = e.target;
      if (!(t instanceof Node)) return;
      if (containerRef.current?.contains(t) || popupRef.current?.contains(t)) return;
      setIsOpen(false);
    };
    document.addEventListener('pointerdown', handler, true);
    return () => document.removeEventListener('pointerdown', handler, true);
  }, [isOpen]);

  const openPopup = () => setIsOpen(true);
  const closePopup = () => setIsOpen(false);

  const handleMouseEnter = () => {
    const t = setTimeout(openPopup, 300);
    setHoverTimer(t);
  };
  const handleMouseLeave = () => {
    if (hoverTimer) { clearTimeout(hoverTimer); setHoverTimer(null); }
  };

  const allModels = usageData?.weekly?.find((b) => b.label === 'All models');
  const weeklyPct = allModels?.pct ?? null;

  return (
    <div ref={containerRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setIsOpen((v) => !v)}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        className={`flex h-7 items-center gap-1.5 rounded-md border px-2 text-xs font-medium transition-all duration-150 ${
          ctxPct >= 75
            ? 'border-red-300/60 bg-red-50 text-red-700 dark:border-red-600/40 dark:bg-red-900/15 dark:text-red-300'
            : ctxPct >= 50
              ? 'border-amber-300/60 bg-amber-50 text-amber-700 dark:border-amber-600/40 dark:bg-amber-900/15 dark:text-amber-300'
              : 'border-border/60 bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground'
        }`}
      >
        <span className="text-[10px] uppercase tracking-wider opacity-60">ctx</span>
        <span className={`tabular-nums ${pctColor(ctxPct)}`}>
          {ctxPct.toFixed(0)}%
        </span>
        {provider === 'claude' && sessionPct !== null && (
          <>
            <span className="opacity-30">·</span>
            <span className={`tabular-nums ${pctColor(sessionPct)}`}>{sessionPct}%</span>
          </>
        )}
        {provider === 'claude' && hasKey === false && onOpenSettings && (
          <>
            <span className="opacity-30">·</span>
            <BarChart2 className="h-3 w-3 opacity-40" />
          </>
        )}
      </button>

      {isOpen && typeof document !== 'undefined' && createPortal(
        <div
          ref={popupRef}
          style={popupStyle || { position: 'fixed', top: 0, left: 0, visibility: 'hidden' }}
          className="flex flex-col overflow-hidden rounded-xl border border-border bg-popover shadow-xl"
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-border px-3 py-2.5">
            <h3 className="text-xs font-semibold text-foreground">Context &amp; Usage</h3>
            <button
              type="button"
              onClick={closePopup}
              className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          {/* Context section */}
          <div className="space-y-2 px-3 py-3">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Context window</p>
            <ProgressBar pct={ctxPct} />
            <div className="flex items-center justify-between text-xs">
              <span className={`font-medium tabular-nums ${pctColor(ctxPct)}`}>{ctxPct.toFixed(1)}% used</span>
              <span className="text-muted-foreground tabular-nums">
                {used.toLocaleString()} / {total.toLocaleString()}
              </span>
            </div>
            <div className="flex justify-between text-[11px] text-muted-foreground/70">
              <span>Free</span>
              <span className="tabular-nums">{Math.max(0, total - used).toLocaleString()} tokens</span>
            </div>
          </div>

          {/* Usage section — Claude provider only */}
          {provider === 'claude' && (
            <>
              <div className="border-t border-border/50" />
              <div className="px-3 py-3">
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Claude.ai subscription
                  </p>
                  {hasKey && (
                    <button
                      type="button"
                      onClick={() => void fetchUsage(true)}
                      disabled={loadingUsage}
                      className="rounded p-0.5 text-muted-foreground/50 hover:text-muted-foreground disabled:opacity-30"
                      title="Refresh usage"
                    >
                      <RefreshCw className={`h-3 w-3 ${loadingUsage ? 'animate-spin' : ''}`} />
                    </button>
                  )}
                </div>

                {hasKey === null || (hasKey && !usageData) ? (
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground/50">
                    <RefreshCw className="h-3 w-3 animate-spin" />
                    <span>Loading…</span>
                  </div>
                ) : !hasKey ? (
                  <div className="space-y-1.5">
                    <p className="text-xs text-muted-foreground/70">Usage tracking not configured.</p>
                    {onOpenSettings && (
                      <button
                        type="button"
                        onClick={() => { closePopup(); onOpenSettings(); }}
                        className="text-xs text-primary hover:underline"
                      >
                        Set up in Settings →
                      </button>
                    )}
                  </div>
                ) : usageData ? (
                  <div className="space-y-1.5">
                    {usageData.plan && (
                      <div className="flex justify-between text-xs">
                        <span className="text-muted-foreground">Plan</span>
                        <span className="font-medium capitalize">{usageData.plan}</span>
                      </div>
                    )}
                    {usageData.session && sessionPct !== null && (
                      <div className="space-y-0.5">
                        <div className="flex justify-between text-xs">
                          <span className="text-muted-foreground">Session</span>
                          <span className={`font-medium tabular-nums ${pctColor(sessionPct)}`}>{sessionPct}%</span>
                        </div>
                        {usageData.session.reset_in && (
                          <p className="text-right text-[10px] text-muted-foreground/50">resets in {usageData.session.reset_in}</p>
                        )}
                      </div>
                    )}
                    {allModels && weeklyPct !== null && (
                      <div className="space-y-0.5">
                        <div className="flex justify-between text-xs">
                          <span className="text-muted-foreground">Weekly</span>
                          <span className={`font-medium tabular-nums ${pctColor(weeklyPct)}`}>{weeklyPct}%</span>
                        </div>
                        {allModels.reset_in && (
                          <p className="text-right text-[10px] text-muted-foreground/50">resets in {allModels.reset_in}</p>
                        )}
                      </div>
                    )}
                    {usageData.error && (
                      <p className="text-xs text-destructive">{usageData.error}</p>
                    )}
                  </div>
                ) : null}
              </div>
            </>
          )}

          {/* Footer note */}
          <div className="border-t border-border/50 bg-muted/30 px-3 py-2">
            <p className="text-[10px] text-muted-foreground/60">
              For per-category breakdown, run <code className="rounded bg-muted px-1">/context</code> in Claude CLI
            </p>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
