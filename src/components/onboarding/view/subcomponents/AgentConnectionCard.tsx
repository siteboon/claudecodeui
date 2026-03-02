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
    <div className={`border rounded-lg p-4 transition-colors ${containerClassName}`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className={`w-10 h-10 rounded-full flex items-center justify-center ${iconContainerClassName}`}>
            <SessionProviderLogo provider={provider} className="w-5 h-5" />
          </div>

          <div>
            <div className="font-medium text-foreground flex items-center gap-2">
              {title}
              {status.authenticated && <Check className="w-4 h-4 text-green-500" />}
            </div>
            <div className="text-xs text-muted-foreground">{statusText}</div>
          </div>
        </div>

        {!status.authenticated && !status.loading && (
          <button
            onClick={onLogin}
            className={`${loginButtonClassName} text-white text-sm font-medium py-2 px-4 rounded-lg transition-colors`}
          >
            Login
          </button>
        )}
      </div>
    </div>
  );
}
