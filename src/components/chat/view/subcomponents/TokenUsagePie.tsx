type TokenUsagePieProps = {
  used: number;
  total: number;
  onClick?: () => void;
};

export default function TokenUsagePie({ used, total, onClick }: TokenUsagePieProps) {
  // Token usage visualization component
  // Only bail out on missing values or non‐positive totals; allow used===0 to render 0%
  if (used == null || total == null || total <= 0) return null;

  const percentage = Math.min(100, (used / total) * 100);
  const radius = 10;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (percentage / 100) * circumference;

  // Color based on usage level
  const getColor = () => {
    if (percentage < 50) return '#3b82f6'; // blue
    if (percentage < 75) return '#f59e0b'; // orange
    return '#ef4444'; // red
  };

  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-2 rounded-lg border border-border/60 bg-muted/50 px-2.5 py-1 text-xs text-gray-600 transition-all duration-200 hover:bg-muted dark:text-gray-400 sm:px-3 sm:py-1.5"
      title={`${used.toLocaleString()} / ${total.toLocaleString()} tokens — Click to compact context`}
    >
      <svg width="24" height="24" viewBox="0 0 24 24" className="-rotate-90 transform">
        {/* Background circle */}
        <circle
          cx="12"
          cy="12"
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className="text-gray-300 dark:text-gray-600"
        />
        {/* Progress circle */}
        <circle
          cx="12"
          cy="12"
          r={radius}
          fill="none"
          stroke={getColor()}
          strokeWidth="2"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
        />
      </svg>
      <span>
        {percentage.toFixed(1)}%
      </span>
    </button>
  );
}