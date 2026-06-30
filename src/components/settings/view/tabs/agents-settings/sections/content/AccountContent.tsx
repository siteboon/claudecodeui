import {
  KeyRound,
  Layers3,
  LogIn,
  type LucideIcon,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Badge, Button } from '../../../../../../../shared/view/ui';
import SessionProviderLogo from '../../../../../../llm-logo-provider/SessionProviderLogo';
import type { AgentProvider, AuthStatus } from '../../../../../types/types';

type AccountContentProps = {
  agent: AgentProvider;
  authStatus: AuthStatus;
  onLogin: (customCommand?: string, customTitle?: string) => void;
};

type AgentVisualConfig = {
  name: string;
  bgClass: string;
  borderClass: string;
  textClass: string;
  subtextClass: string;
  buttonClass: string;
  description?: string;
};

const agentConfig: Record<AgentProvider, AgentVisualConfig> = {
  claude: {
    name: 'Claude',
    bgClass: 'bg-blue-50 dark:bg-blue-900/20',
    borderClass: 'border-blue-200 dark:border-blue-800',
    textClass: 'text-blue-900 dark:text-blue-100',
    subtextClass: 'text-blue-700 dark:text-blue-300',
    buttonClass: 'bg-blue-600 hover:bg-blue-700 active:bg-blue-800',
  },
  cursor: {
    name: 'Cursor',
    bgClass: 'bg-purple-50 dark:bg-purple-900/20',
    borderClass: 'border-purple-200 dark:border-purple-800',
    textClass: 'text-purple-900 dark:text-purple-100',
    subtextClass: 'text-purple-700 dark:text-purple-300',
    buttonClass: 'bg-purple-600 hover:bg-purple-700 active:bg-purple-800',
  },
  codex: {
    name: 'Codex',
    bgClass: 'bg-muted/50',
    borderClass: 'border-gray-300 dark:border-gray-600',
    textClass: 'text-gray-900 dark:text-gray-100',
    subtextClass: 'text-gray-700 dark:text-gray-300',
    buttonClass: 'bg-gray-800 hover:bg-gray-900 active:bg-gray-950 dark:bg-gray-700 dark:hover:bg-gray-600 dark:active:bg-gray-500',
  },
  gemini: {
    name: 'Gemini',
    description: 'Google Gemini AI assistant',
    bgClass: 'bg-indigo-50 dark:bg-indigo-900/20',
    borderClass: 'border-indigo-200 dark:border-indigo-800',
    textClass: 'text-indigo-900 dark:text-indigo-100',
    subtextClass: 'text-indigo-700 dark:text-indigo-300',
    buttonClass: 'bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800',
  },
  opencode: {
    name: 'OpenCode',
    description: 'OpenCode CLI assistant',
    bgClass: 'bg-zinc-50 dark:bg-zinc-900/20',
    borderClass: 'border-zinc-200 dark:border-zinc-700',
    textClass: 'text-zinc-900 dark:text-zinc-100',
    subtextClass: 'text-zinc-700 dark:text-zinc-300',
    buttonClass: 'bg-zinc-900 hover:bg-zinc-800 active:bg-zinc-950 dark:bg-zinc-700 dark:hover:bg-zinc-600',
  },
  hermes: {
    name: 'Hermes',
    description: 'Nous Research Hermes Agent',
    bgClass: 'bg-emerald-50 dark:bg-emerald-900/20',
    borderClass: 'border-emerald-200 dark:border-emerald-800',
    textClass: 'text-emerald-950 dark:text-emerald-100',
    subtextClass: 'text-emerald-700 dark:text-emerald-300',
    buttonClass: 'bg-emerald-700 hover:bg-emerald-800 active:bg-emerald-900',
  },
};

type HermesAction = {
  label: string;
  buttonLabel: string;
  description: string;
  command: string;
  title: string;
  icon: LucideIcon;
};

const hermesActions: HermesAction[] = [
  {
    label: 'Model',
    buttonLabel: 'Configure',
    description: 'Choose the provider and model Hermes should use.',
    command: 'hermes model',
    title: 'Configure Hermes Model',
    icon: Layers3,
  },
  {
    label: 'Credentials',
    buttonLabel: 'Manage',
    description: 'Update credential pools and API keys.',
    command: 'hermes auth',
    title: 'Hermes Credentials',
    icon: KeyRound,
  },
];

export default function AccountContent({ agent, authStatus, onLogin }: AccountContentProps) {
  const { t } = useTranslation('settings');
  const config = agentConfig[agent];
  const isHermes = agent === 'hermes';

  return (
    <div className="space-y-6">
      <div className="mb-4 flex items-center gap-3">
        <SessionProviderLogo provider={agent} className="h-6 w-6" />
        <div>
          <h3 className="text-lg font-medium text-foreground">{config.name}</h3>
          <p className="text-sm text-muted-foreground">
            {t(`agents.account.${agent}.description`, {
              defaultValue: config.description || `${config.name} CLI assistant`,
            })}
          </p>
        </div>
      </div>

      <div className={`${config.bgClass} border ${config.borderClass} rounded-lg p-4`}>
        {isHermes ? (
          <div className="space-y-4">
            <div>
              <div className={`font-medium ${config.textClass}`}>
                {t('agents.hermes.configuration.title', { defaultValue: 'Hermes configuration' })}
              </div>
              <div className={`text-sm ${config.subtextClass}`}>
                {t('agents.hermes.configuration.description', {
                  defaultValue: 'Models and credentials are managed by Hermes.',
                })}
              </div>
            </div>
            <div className="overflow-hidden rounded-lg border border-border/60 bg-background/70">
              {hermesActions.map((action, index) => {
                const Icon = action.icon;
                return (
                  <div
                    key={action.command}
                    className={`flex flex-col gap-3 px-3 py-3 sm:flex-row sm:items-center sm:justify-between ${
                      index > 0 ? 'border-t border-border/60' : ''
                    }`}
                  >
                    <div className="flex min-w-0 items-start gap-3">
                      <div className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md bg-muted/60 text-muted-foreground">
                        <Icon className="h-4 w-4" />
                      </div>
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-foreground">{action.label}</div>
                        <div className="mt-0.5 text-sm text-muted-foreground">{action.description}</div>
                      </div>
                    </div>
                    <Button
                      type="button"
                      variant={index === 0 ? 'default' : 'outline'}
                      size="sm"
                      className={index === 0 ? `${config.buttonClass} w-full text-white sm:w-auto` : 'w-full sm:w-auto'}
                      onClick={() => onLogin(action.command, action.title)}
                    >
                      {action.buttonLabel}
                    </Button>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="flex-1">
                <div className={`font-medium ${config.textClass}`}>
                  {t('agents.connectionStatus')}
                </div>
                <div className={`text-sm ${config.subtextClass}`}>
                  {authStatus.loading ? (
                    t('agents.authStatus.checkingAuth')
                  ) : authStatus.authenticated ? (
                    t('agents.authStatus.loggedInAs', {
                      email: authStatus.email || t('agents.authStatus.authenticatedUser'),
                    })
                  ) : (
                    t('agents.authStatus.notConnected')
                  )}
                </div>
              </div>
              <div>
                {authStatus.loading ? (
                  <Badge variant="secondary" className="bg-muted">
                    {t('agents.authStatus.checking')}
                  </Badge>
                ) : authStatus.authenticated ? (
                  <Badge variant="secondary" className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300">
                    {t('agents.authStatus.connected')}
                  </Badge>
                ) : (
                  <Badge variant="secondary" className="bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300">
                    {t('agents.authStatus.disconnected')}
                  </Badge>
                )}
              </div>
            </div>

            {authStatus.method !== 'api_key' && (
              <div className="border-t border-border/50 pt-4">
                <div className="flex items-center justify-between">
                  <div>
                    <div className={`font-medium ${config.textClass}`}>
                      {authStatus.authenticated ? t('agents.login.reAuthenticate') : t('agents.login.title')}
                    </div>
                    <div className={`text-sm ${config.subtextClass}`}>
                      {authStatus.authenticated
                        ? t('agents.login.reAuthDescription')
                        : t('agents.login.description', { agent: config.name })}
                    </div>
                  </div>
                  <Button
                    onClick={() => onLogin()}
                    className={`${config.buttonClass} text-white`}
                    size="sm"
                  >
                    <LogIn className="mr-2 h-4 w-4" />
                    {authStatus.authenticated ? t('agents.login.reLoginButton') : t('agents.login.button')}
                  </Button>
                </div>
              </div>
            )}

            {authStatus.error && (
              <div className="border-t border-border/50 pt-4">
                <div className="text-sm text-red-600 dark:text-red-400">
                  {t('agents.error', { error: authStatus.error })}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
