import { Check } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import LLMProviderLogo from '../../../llm-provider-logo/LLMProviderLogo';
import type { LLMProvider } from '../../../../types/app';
import type { ProviderAuthStatus } from '../../../provider-auth/types';

type AgentConnectionCardProps = {
  provider: LLMProvider;
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
  const { t } = useTranslation('auth');
  const containerClassName = status.authenticated ? connectedClassName : 'border-border bg-card';

  const statusText = status.loading
    ? t('onboarding.checking')
    : status.authenticated
      ? status.email || t('onboarding.connected')
      : status.error || t('onboarding.notConnected');

  return (
    <div className={`rounded-xl border px-3 py-2.5 transition-colors ${containerClassName}`}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full ${iconContainerClassName}`}>
            <LLMProviderLogo provider={provider} className="h-5 w-5" />
          </div>

          <div className="min-w-0">
            <div className="flex items-center gap-1.5 text-sm font-medium text-foreground">
              {title}
              {status.authenticated && <Check className="h-3.5 w-3.5 flex-shrink-0 text-emerald-500" />}
            </div>
            <div className="truncate text-xs text-muted-foreground" title={statusText}>{statusText}</div>
          </div>
        </div>

        {!status.authenticated && !status.loading && (
          <button
            onClick={onLogin}
            className={`${loginButtonClassName} flex-shrink-0 rounded-lg px-4 py-1.5 text-sm font-medium text-white transition-colors`}
          >
            {t('onboarding.login')}
          </button>
        )}
      </div>
    </div>
  );
}
