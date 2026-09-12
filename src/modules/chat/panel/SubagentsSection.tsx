import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Bot, CircleAlert, CircleCheck, Loader } from 'lucide-react';

import { cn } from '@/shared/utils';
import type { SubagentSummary } from '@/shared/types';

type SubagentsSectionProps = {
  subagents: SubagentSummary[];
  loading: boolean;
  /** Opens one agent's conversation overlay. */
  onSelect: (summary: SubagentSummary) => void;
};

/**
 * One row per agent the session spawned. The label leads with the agent type
 * Claude presets (Explore, Plan) or the neutral word, and the task the parent
 * assigned rides alongside it. Tapping a row opens the agent's own
 * conversation in SubagentChatModal.
 */
export const SubagentsSection = memo(({ subagents, loading, onSelect }: SubagentsSectionProps) => {
  const { t } = useTranslation('chat');

  if (subagents.length === 0) {
    return (
      <div className="py-1 text-xs text-muted-foreground">
        {loading ? t('sessionInfoPanel.subagentsLoading') : t('sessionInfoPanel.empty')}
      </div>
    );
  }

  return (
    <ul className="space-y-0.5 py-0.5">
      {subagents.map((agent) => (
        <li key={agent.agentId}>
          <button
            type="button"
            onClick={() => onSelect(agent)}
            className="flex w-full items-center gap-1.5 rounded px-1 py-1 text-left text-xs hover:bg-muted/50"
          >
            {agent.status === 'running' ? (
              <Loader className="h-3.5 w-3.5 flex-shrink-0 animate-spin text-purple-500" />
            ) : agent.status === 'failed' ? (
              <CircleAlert className="h-3.5 w-3.5 flex-shrink-0 text-red-500" />
            ) : (
              <CircleCheck className="h-3.5 w-3.5 flex-shrink-0 text-green-500" />
            )}
            <Bot className="h-3 w-3 flex-shrink-0 text-purple-500/80 dark:text-purple-400/80" />
            <span className="flex-shrink-0 font-medium text-foreground">
              {agent.agentType || t('sessionInfoPanel.subagentsAgentLabel')}
            </span>
            {agent.description && (
              <span className="min-w-0 flex-1 truncate text-muted-foreground" title={agent.description}>
                {agent.description}
              </span>
            )}
            <span className={cn('ml-auto flex-shrink-0 text-[10px] tabular-nums', agent.status === 'running' ? 'text-purple-500' : 'text-muted-foreground/60')}>
              {agent.activityCount}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
});
SubagentsSection.displayName = 'SubagentsSection';
