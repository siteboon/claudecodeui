type TokenUsagePieProps = {
  used: number;
  total: number;
};

export default function TokenUsagePie({ used, total }: TokenUsagePieProps) {
  if (used == null || total == null || total <= 0) return null;

  const percentage = Math.min(100, (used / total) * 100);

  const colorClass =
    percentage < 50
      ? 'text-blue-500 dark:text-blue-400'
      : percentage < 75
        ? 'text-amber-500 dark:text-amber-400'
        : 'text-red-500 dark:text-red-400';

  return (
    <div
      className="flex items-center gap-1 text-xs"
      title={`Context: ${used.toLocaleString()} / ${total.toLocaleString()} tokens (${percentage.toFixed(1)}%)`}
    >
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground/50">ctx</span>
      <span className={`tabular-nums font-medium ${colorClass}`}>
        {percentage.toFixed(0)}%
      </span>
    </div>
  );
}