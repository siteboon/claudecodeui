type TokenUsagePieProps = {
  used: number;
  total: number;
};

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}k`;
  return `${n}`;
}

export default function TokenUsagePie({ used, total }: TokenUsagePieProps) {
  if (used == null || total == null || total <= 0) return null;

  const percentage = Math.min(100, (used / total) * 100);
  const size = 26;
  const radius = 10;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (percentage / 100) * circumference;

  const strokeColor =
    percentage < 50 ? '#3b82f6' : percentage < 75 ? '#f59e0b' : '#ef4444';

  return (
    <div
      className="flex items-center gap-1.5 text-[10px] text-muted-foreground"
      title={`${used.toLocaleString()} / ${total.toLocaleString()} tokens`}
    >
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox="0 0 26 26" className="-rotate-90">
          <circle
            cx="13"
            cy="13"
            r={radius}
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            className="opacity-20"
          />
          <circle
            cx="13"
            cy="13"
            r={radius}
            fill="none"
            stroke={strokeColor}
            strokeWidth="2"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            strokeLinecap="round"
          />
        </svg>
        <span className="absolute inset-0 flex items-center justify-center text-[8px] font-medium tabular-nums text-foreground/80">
          {Math.round(percentage)}%
        </span>
      </div>
      <span className="tabular-nums">{formatTokens(used)}</span>
    </div>
  );
}
