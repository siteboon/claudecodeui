import type { LLMProvider } from '../../../../types/app';
import type { ProviderAuthStatusMap } from '../../../provider-auth/types';
import AgentConnectionCard from './AgentConnectionCard';

type AgentConnectionsStepProps = {
  providerStatuses: ProviderAuthStatusMap;
  onOpenProviderLogin: (provider: LLMProvider) => void;
};

const providerCards = [
  {
    provider: 'claude' as const,
    title: 'Claude Code',
    connectedClassName: 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800',
    iconContainerClassName: 'bg-blue-100 dark:bg-blue-900/30',
    loginButtonClassName: 'bg-blue-600 hover:bg-blue-700',
  },
  {
    provider: 'cursor' as const,
    title: 'Cursor',
    connectedClassName: 'bg-purple-50 dark:bg-purple-900/20 border-purple-200 dark:border-purple-800',
    iconContainerClassName: 'bg-purple-100 dark:bg-purple-900/30',
    loginButtonClassName: 'bg-purple-600 hover:bg-purple-700',
  },
  {
    provider: 'codex' as const,
    title: 'OpenAI Codex',
    connectedClassName: 'bg-gray-100 dark:bg-gray-800/50 border-gray-300 dark:border-gray-600',
    iconContainerClassName: 'bg-gray-100 dark:bg-gray-800',
    loginButtonClassName: 'bg-gray-800 hover:bg-gray-900 dark:bg-gray-700 dark:hover:bg-gray-600',
  },
  {
    provider: 'gemini' as const,
    title: 'Gemini',
    connectedClassName: 'bg-teal-50 dark:bg-teal-900/20 border-teal-200 dark:border-teal-800',
    iconContainerClassName: 'bg-teal-100 dark:bg-teal-900/30',
    loginButtonClassName: 'bg-teal-600 hover:bg-teal-700',
  },
];

export default function AgentConnectionsStep({
  providerStatuses,
  onOpenProviderLogin,
}: AgentConnectionsStepProps) {
  return (
    <div className="space-y-6">
      <div className="mb-6 text-center">
        <h2 className="mb-2 text-2xl font-bold text-foreground">Connect Your AI Agents</h2>
        <p className="text-muted-foreground">
          Login to one or more AI coding assistants. All are optional.
        </p>
      </div>

      <div className="space-y-3">
        {providerCards.map((providerCard) => (
          <AgentConnectionCard
            key={providerCard.provider}
            provider={providerCard.provider}
            title={providerCard.title}
            status={providerStatuses[providerCard.provider]}
            connectedClassName={providerCard.connectedClassName}
            iconContainerClassName={providerCard.iconContainerClassName}
            loginButtonClassName={providerCard.loginButtonClassName}
            onLogin={() => onOpenProviderLogin(providerCard.provider)}
          />
        ))}
      </div>

      <div className="pt-2 text-center text-sm text-muted-foreground">
        <p>You can configure these later in Settings.</p>
      </div>
    </div>
  );
}
