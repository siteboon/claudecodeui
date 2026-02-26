import type { AgentProvider } from '../../../../types/types';
import AgentListItem from '../AgentListItem';
import type { AgentSelectorSectionProps } from '../types';

const AGENT_PROVIDERS: AgentProvider[] = ['claude', 'cursor', 'codex'];

export default function AgentSelectorSection({
  selectedAgent,
  onSelectAgent,
  agentContextById,
}: AgentSelectorSectionProps) {
  return (
    <>
      <div className="md:hidden border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
        <div className="flex">
          {AGENT_PROVIDERS.map((agent) => (
            <AgentListItem
              key={`mobile-${agent}`}
              agentId={agent}
              authStatus={agentContextById[agent].authStatus}
              isSelected={selectedAgent === agent}
              onClick={() => onSelectAgent(agent)}
              isMobile
            />
          ))}
        </div>
      </div>

      <div className="hidden md:block w-48 border-r border-gray-200 dark:border-gray-700 flex-shrink-0">
        <div className="p-2">
          {AGENT_PROVIDERS.map((agent) => (
            <AgentListItem
              key={`desktop-${agent}`}
              agentId={agent}
              authStatus={agentContextById[agent].authStatus}
              isSelected={selectedAgent === agent}
              onClick={() => onSelectAgent(agent)}
            />
          ))}
        </div>
      </div>
    </>
  );
}
