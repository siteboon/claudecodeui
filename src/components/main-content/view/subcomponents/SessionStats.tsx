type SessionStatsProps = {
  tokenCount?: number;
  costCents?: number;
  elapsedSeconds?: number;
};

function formatTokens(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}k`;
  return String(count);
}

function formatCost(cents: number): string {
  if (cents < 1) return '<$0.01';
  return `$${(cents / 100).toFixed(2)}`;
}

function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return secs > 0 ? `${mins}m${secs}s` : `${mins}m`;
}

export default function SessionStats({
  tokenCount,
  costCents,
  elapsedSeconds,
}: SessionStatsProps) {
  const parts: string[] = [];

  if (tokenCount != null && tokenCount > 0) {
    parts.push(formatTokens(tokenCount));
  }
  if (costCents != null && costCents > 0) {
    parts.push(formatCost(costCents));
  }
  if (elapsedSeconds != null && elapsedSeconds > 0) {
    parts.push(formatElapsed(elapsedSeconds));
  }

  if (parts.length === 0) return null;

  return (
    <span className="flex-shrink-0 font-mono text-[10px] text-muted-foreground/60">
      {parts.join(' · ')}
    </span>
  );
}
