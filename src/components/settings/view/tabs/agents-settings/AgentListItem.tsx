import { cn } from '../../../../../lib/utils';
import SessionProviderLogo from '../../../../llm-logo-provider/SessionProviderLogo';
import type { AgentProvider, AuthStatus } from '../../../types/types';

type AgentListItemProps = {
  agentId: AgentProvider;
  authStatus: AuthStatus;
  isSelected: boolean;
  onClick: () => void;
  isMobile?: boolean;
};

type AgentConfig = {
  name: string;
  color: 'blue' | 'purple' | 'gray' | 'indigo';
};

const agentConfig: Record<AgentProvider, AgentConfig> = {
  claude: {
    name: 'Claude',
    color: 'blue',
  },
  cursor: {
    name: 'Cursor',
    color: 'purple',
  },
  codex: {
    name: 'Codex',
    color: 'gray',
  },
  gemini: {
    name: 'Gemini',
    color: 'indigo',
  }
};

const colorClasses = {
  blue: {
    dot: 'bg-blue-500',
  },
  purple: {
    dot: 'bg-purple-500',
  },
  gray: {
    dot: 'bg-foreground/60',
  },
  indigo: {
    dot: 'bg-indigo-500',
  },
} as const;

export default function AgentListItem({
  agentId,
  authStatus,
  isSelected,
  onClick,
  isMobile = false,
}: AgentListItemProps) {
  const config = agentConfig[agentId];
  const colors = colorClasses[config.color];

  if (isMobile) {
    return (
      <button
        onClick={onClick}
        className={cn(
          'min-w-0 flex-1 touch-manipulation rounded-md px-2 py-2 text-center transition-all duration-150',
          isSelected
            ? 'bg-background text-foreground shadow-sm'
            : 'text-muted-foreground active:bg-background/50',
        )}
      >
        <div className="flex items-center justify-center gap-1.5">
          <SessionProviderLogo provider={agentId} className="h-4 w-4 flex-shrink-0" />
          <span className="truncate text-xs font-medium">{config.name}</span>
          {authStatus.authenticated && (
            <span className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${colors.dot}`} />
          )}
        </div>
      </button>
    );
  }

  return (
    <button
      onClick={onClick}
      className={cn(
        'flex touch-manipulation items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-all duration-150',
        isSelected
          ? 'bg-background text-foreground shadow-sm'
          : 'text-muted-foreground active:bg-background/50',
      )}
    >
      <SessionProviderLogo provider={agentId} className="h-4 w-4 flex-shrink-0" />
      <span>{config.name}</span>
      {authStatus.authenticated ? (
        <span className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${colors.dot}`} />
      ) : authStatus.loading ? (
        <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-muted-foreground/30 animate-pulse" />
      ) : null}
    </button>
  );
}
