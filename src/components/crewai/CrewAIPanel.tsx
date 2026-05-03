import { X } from 'lucide-react';
import type { CrewAIAgentStatus } from './types';

type CrewAIPanelProps = {
  agents: CrewAIAgentStatus[];
  isOpen: boolean;
  onClose: () => void;
};

const STATUS_COLORS: Record<CrewAIAgentStatus['status'], string> = {
  idle: 'bg-gray-400',
  working: 'bg-yellow-500 animate-pulse',
  complete: 'bg-green-500',
  error: 'bg-red-500',
};

export default function CrewAIPanel({ agents, isOpen, onClose }: CrewAIPanelProps) {
  if (!isOpen) {
    return null;
  }

  return (
    <div className="flex h-full w-80 flex-col border-l border-border bg-background">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h3 className="text-sm font-semibold">CrewAI Agents</h3>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {agents.length === 0 ? (
          <p className="text-center text-sm text-muted-foreground">No agents running</p>
        ) : (
          <div className="space-y-3">
            {agents.map((agent) => (
              <div key={agent.role} className="rounded-lg border border-border p-3">
                <div className="mb-1 flex items-center gap-2">
                  <span className={`h-2 w-2 rounded-full ${STATUS_COLORS[agent.status]}`} />
                  <span className="text-sm font-medium">{agent.role}</span>
                </div>
                {agent.task && (
                  <p className="mb-1 text-xs text-muted-foreground">{agent.task}</p>
                )}
                {agent.output && (
                  <p className="text-xs text-foreground/80">{agent.output}</p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
