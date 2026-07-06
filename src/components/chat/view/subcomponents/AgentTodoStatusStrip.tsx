import { useEffect, useState } from 'react';
import { CheckCircle2, ChevronDown } from 'lucide-react';

import { TodoListContent } from '../../tools/components/ContentRenderers';
import type { AgentTodoSummary } from '../../utils/agentTodoSummary';

type AgentTodoStatusStripProps = {
  summaries: AgentTodoSummary[];
};

function formatAge(updatedAt: Date, now: number): string {
  const seconds = Math.max(0, Math.floor((now - updatedAt.getTime()) / 1000));
  if (seconds < 60) return `${seconds}s`;

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;

  return `${Math.floor(hours / 24)}d`;
}

export default function AgentTodoStatusStrip({ summaries }: AgentTodoStatusStripProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (summaries.length === 0) return;

    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [summaries.length]);

  useEffect(() => {
    if (expandedId && !summaries.some((summary) => summary.id === expandedId)) {
      setExpandedId(null);
    }
  }, [expandedId, summaries]);

  if (summaries.length === 0) return null;

  return (
    <div className="pointer-events-auto flex flex-col gap-1.5">
      <div className="flex flex-wrap items-end gap-1.5">
        {summaries.map((summary) => {
          const isExpanded = summary.id === expandedId;
          const totalCount = summary.todos.length;
          const activeText = summary.activeTodo || 'No active todo';

          return (
            <button
              key={summary.id}
              type="button"
              onClick={() => setExpandedId(isExpanded ? null : summary.id)}
              className="inline-flex h-8 max-w-full items-center gap-1.5 rounded-t-lg border border-b-0 border-border/50 bg-card px-2.5 text-xs text-muted-foreground shadow-[0_-1px_1px_hsl(var(--foreground)/0.04),1px_0_1px_hsl(var(--foreground)/0.03),-1px_0_1px_hsl(var(--foreground)/0.03)] transition-colors hover:bg-card hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-expanded={isExpanded}
              title={`${summary.label}: ${activeText}`}
            >
              <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
              <span className="min-w-0 max-w-32 truncate font-medium text-foreground">{summary.label}</span>
              <span className="min-w-0 max-w-48 truncate">{activeText}</span>
              <span className="shrink-0 tabular-nums text-muted-foreground/70">
                {summary.completedCount}/{totalCount}
              </span>
              <span className="shrink-0 tabular-nums text-muted-foreground/60">
                {formatAge(summary.updatedAt, now)}
              </span>
              <ChevronDown
                className={`h-3.5 w-3.5 shrink-0 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                aria-hidden
              />
            </button>
          );
        })}
      </div>

      {summaries.map((summary) => (
        summary.id === expandedId && (
          <div
            key={`${summary.id}-panel`}
            className="max-w-xl rounded-md border border-border/70 bg-card p-2 text-xs shadow-sm"
          >
            <TodoListContent todos={summary.todos} isResult />
          </div>
        )
      ))}
    </div>
  );
}
