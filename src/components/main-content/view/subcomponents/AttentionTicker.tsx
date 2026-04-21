import { AlertCircle, ChevronRight } from 'lucide-react';

type AttentionTickerProps = {
  waitingCount: number;
  onJumpToNextWaiting: () => void;
};

export default function AttentionTicker({
  waitingCount,
  onJumpToNextWaiting,
}: AttentionTickerProps) {
  if (waitingCount === 0) return null;

  return (
    <button
      onClick={onJumpToNextWaiting}
      className="flex flex-shrink-0 items-center gap-1 rounded-full bg-attention/15 px-2 py-0.5 text-[11px] font-medium text-attention transition-colors hover:bg-attention/25"
    >
      <AlertCircle className="h-3 w-3" />
      <span>
        {waitingCount} need{waitingCount === 1 ? 's' : ''} you
      </span>
      <ChevronRight className="h-3 w-3" />
    </button>
  );
}
