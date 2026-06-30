import {
  CheckCircle2,
  KeyRound,
  Layers3,
  LogIn,
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
  description: string;
  command: string;
  title: string;
  icon: typeof Layers3;
};

type HermesActionGroup = {
  title: string;
  actions: HermesAction[];
};

const hermesActionGroups: HermesActionGroup[] = [
  {
    title: 'Setup',
    actions: [
      {
        label: 'Provider setup',
        description: 'Configure provider credentials and the active model.',
        command: 'hermes model',
        title: 'Hermes Provider Setup',
        icon: Layers3,
      },
      {
        label: 'Credential pools',
        description: 'Manage API keys and OAuth credentials.',
        command: 'hermes auth',
        title: 'Hermes Credential Pools',
        icon: KeyRound,
      },
      {
        label: 'ACP check',
        description: 'Validate the Hermes ACP adapter.',
        command: 'hermes acp --check',
        title: 'Hermes ACP Check',
        icon: CheckCircle2,
      },
    ],
  },
];

export default function AccountContent({ agent, authStatus, onLogin }: AccountContentProps) {
  const { t } = useTranslation('settings');
  const config = agentConfig[agent];
  const isHermes = agent === 'hermes';
  const hermesReady = authStatus.installed;

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
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="flex-1">
              <div className={`font-medium ${config.textClass}`}>
                {isHermes
                  ? t('agents.hermes.setupStatus.title', { defaultValue: 'Setup status' })
                  : t('agents.connectionStatus')}
              </div>
              <div className={`text-sm ${config.subtextClass}`}>
                {authStatus.loading ? (
                  t('agents.authStatus.checkingAuth')
                ) : isHermes ? (
                  hermesReady
                    ? t('agents.hermes.setupStatus.readyDescription', { defaultValue: 'Hermes ACP is installed. Credentials and models are managed by Hermes.' })
                    : t('agents.hermes.setupStatus.needsSetupDescription', { defaultValue: 'Install Hermes or run the ACP check to validate the adapter.' })
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
              ) : isHermes ? (
                <Badge
                  variant="secondary"
                  className={
                    hermesReady
                      ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300'
                      : 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300'
                  }
                >
                  {hermesReady
                    ? t('agents.hermes.setupStatus.ready', { defaultValue: 'ACP ready' })
                    : t('agents.hermes.setupStatus.needsSetup', { defaultValue: 'Needs setup' })}
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

          {!isHermes && authStatus.method !== 'api_key' && (
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

          {isHermes && (
            <div className="border-t border-border/50 pt-4">
              <div className={`mb-3 font-medium ${config.textClass}`}>
                {t('agents.hermes.actions.title', { defaultValue: 'Hermes tools' })}
              </div>
              <div className="space-y-4">
                {hermesActionGroups.map((group) => (
                  <div key={group.title}>
                    <div className={`mb-2 text-xs font-semibold uppercase ${config.subtextClass}`}>
                      {group.title}
                    </div>
                    <div className="grid gap-2 md:grid-cols-2">
                      {group.actions.map((action) => {
                        const Icon = action.icon;
                        return (
                          <Button
                            key={action.command}
                            type="button"
                            variant="outline"
                            className="h-auto justify-start gap-3 border-border/70 bg-background/70 px-3 py-2 text-left"
                            onClick={() => onLogin(action.command, action.title)}
                          >
                            <Icon className="h-4 w-4 flex-shrink-0" />
                            <span className="min-w-0">
                              <span className="block text-sm font-medium text-foreground">{action.label}</span>
                              <span className="block text-xs text-muted-foreground">{action.description}</span>
                            </span>
                          </Button>
                        );
                      })}
                    </div>
                  </div>
                ))}
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
      </div>
    </div>
  );
}
