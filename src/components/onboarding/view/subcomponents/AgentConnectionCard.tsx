import { Check } from 'lucide-react';
import SessionProviderLogo from '../../../llm-logo-provider/SessionProviderLogo';
import type { CliProvider, ProviderAuthStatus } from '../types';

type AgentConnectionCardProps = {
  provider: CliProvider;
  title: string;
  status: ProviderAuthStatus;
  connectedClassName: string;
  iconContainerClassName: string;
  loginButtonClassName: string;
  onLogin: () => void;
};

export default function AgentConnectionCard({
  provider,
  title,
  status,
  connectedClassName,
  iconContainerClassName,
  loginButtonClassName,
  onLogin,
}: AgentConnectionCardProps) {
  const containerClassName = status.authenticated ? connectedClassName : 'border-border bg-card';

  const statusText = status.loading
    ? 'Checking...'
    : status.authenticated
      ? status.email || 'Connected'
      : status.error || 'Not connected';

  return (
    <div className={`rounded-lg border p-4 transition-colors ${containerClassName}`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className={`flex h-10 w-10 items-center justify-center rounded-full ${iconContainerClassName}`}>
            <SessionProviderLogo provider={provider} className="h-5 w-5" />
          </div>

          <div>
            <div className="flex items-center gap-2 font-medium text-foreground">
              {title}
              {status.authenticated && <Check className="h-4 w-4 text-green-500" />}
            </div>
            <div className="text-xs text-muted-foreground">{statusText}</div>
          </div>
        </div>

        {!status.authenticated && !status.loading && (
          <button
            onClick={onLogin}
            className={`${loginButtonClassName} rounded-lg px-4 py-2 text-sm font-medium text-white transition-colors`}
          >
            Login
          </button>
        )}
      </div>
    </div>
  );
}
