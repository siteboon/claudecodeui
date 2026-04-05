import { useState, useRef, useEffect, useCallback } from 'react';

type TokenUsagePieProps = {
  used: number;
  total: number;
  onClick?: () => void;
};

function FormatTokens({ value }: { value: number }) {
  if (value >= 1000) {
    return <>{(value / 1000).toFixed(1)}K</>;
  }
  return <>{value.toLocaleString()}</>;
}

function ContextWindowPopup({
  used,
  total,
  percentage,
  color,
  onCompact,
  onClose,
}: {
  used: number;
  total: number;
  percentage: number;
  color: string;
  onCompact: () => void;
  onClose: () => void;
}) {
  const popupRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (popupRef.current && !popupRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [onClose]);

  const remaining = Math.max(0, total - used);
  const remainingPct = total > 0 ? ((remaining / total) * 100).toFixed(1) : '0';

  return (
    <div
      ref={popupRef}
      className="absolute bottom-full right-0 z-50 mb-2 w-64 rounded-lg border border-border bg-popover p-3 shadow-lg"
    >
      {/* Header */}
      <div className="mb-3 text-sm font-semibold text-foreground">Context Window</div>

      {/* Token count and percentage */}
      <div className="mb-2 flex items-baseline justify-between">
        <span className="text-sm text-foreground">
          <FormatTokens value={used} /> / <FormatTokens value={total} /> tokens
        </span>
        <span className="text-sm font-medium text-foreground">{percentage.toFixed(0)}%</span>
      </div>

      {/* Progress bar */}
      <div className="mb-3 h-2 w-full overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full transition-all duration-300"
          style={{ width: `${percentage}%`, backgroundColor: color }}
        />
      </div>

      {/* Reserved for response */}
      <div className="mb-3 flex items-center gap-1.5 text-xs text-muted-foreground">
        <svg className="h-3 w-3 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <span>Reserved for response</span>
      </div>

      <div className="mb-3 border-t border-border" />

      {/* Context breakdown */}
      <div className="mb-3 space-y-1.5 text-xs">
        <div className="font-medium text-muted-foreground">Context Usage</div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Used</span>
          <span className="text-foreground"><FormatTokens value={used} /> tokens</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Remaining</span>
          <span className="text-foreground"><FormatTokens value={remaining} /> ({remainingPct}%)</span>
        </div>
      </div>

      {/* Compact button */}
      <button
        type="button"
        onClick={() => {
          onCompact();
          onClose();
        }}
        className="w-full rounded-md border border-border bg-card px-3 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-accent"
      >
        Compact Conversation
      </button>
    </div>
  );
}

export default function TokenUsagePie({ used, total, onClick }: TokenUsagePieProps) {
  const [showPopup, setShowPopup] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleClick = useCallback(() => {
    setShowPopup((prev) => !prev);
  }, []);

  const handleCompact = useCallback(() => {
    onClick?.();
  }, [onClick]);

  const handleClosePopup = useCallback(() => {
    setShowPopup(false);
  }, []);

  // Only bail out on missing values or non‐positive totals; allow used===0 to render 0%
  if (used == null || total == null || total <= 0) return null;

  const percentage = Math.min(100, (used / total) * 100);
  const radius = 10;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (percentage / 100) * circumference;

  const getColor = () => {
    if (percentage < 50) return '#3b82f6'; // blue
    if (percentage < 75) return '#f59e0b'; // orange
    return '#ef4444'; // red
  };

  const color = getColor();

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={handleClick}
        className="flex items-center gap-2 rounded-lg border border-border/60 bg-muted/50 px-2.5 py-1 text-xs text-gray-600 transition-all duration-200 hover:bg-muted dark:text-gray-400 sm:px-3 sm:py-1.5"
        title={`${used.toLocaleString()} / ${total.toLocaleString()} tokens`}
      >
        <svg width="24" height="24" viewBox="0 0 24 24" className="-rotate-90 transform">
          <circle
            cx="12"
            cy="12"
            r={radius}
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            className="text-gray-300 dark:text-gray-600"
          />
          <circle
            cx="12"
            cy="12"
            r={radius}
            fill="none"
            stroke={color}
            strokeWidth="2"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            strokeLinecap="round"
          />
        </svg>
        <span>{percentage.toFixed(1)}%</span>
      </button>

      {showPopup && (
        <ContextWindowPopup
          used={used}
          total={total}
          percentage={percentage}
          color={color}
          onCompact={handleCompact}
          onClose={handleClosePopup}
        />
      )}
    </div>
  );
}