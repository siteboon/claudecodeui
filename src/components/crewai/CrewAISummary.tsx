import type { CrewAIAgentStatus } from './types';

type CrewAISummaryProps = {
  agents: CrewAIAgentStatus[];
  crewName: string;
};

const STATUS_ICONS: Record<CrewAIAgentStatus['status'], string> = {
  idle: '⏸',
  working: '⏳',
  complete: '✓',
  error: '✗',
};

export default function CrewAISummary({ agents, crewName }: CrewAISummaryProps) {
  const allComplete = agents.length > 0 && agents.every((a) => a.status === 'complete');

  return (
    <div className="rounded-lg border border-border bg-muted/30 p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-semibold">{crewName}</span>
        {allComplete && (
          <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700 dark:bg-green-900/30 dark:text-green-400">
            Complete
          </span>
        )}
      </div>
      <div className="space-y-1">
        {agents.map((agent) => (
          <div key={agent.role} className="flex items-center gap-2 text-xs">
            <span>{STATUS_ICONS[agent.status]}</span>
            <span className="font-medium">{agent.role}</span>
            {agent.task && (
              <span className="text-muted-foreground">— {agent.task}</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
