import {
  AlertCircle,
  CheckCircle2,
  CircleDashed,
  Edit3,
  ExternalLink,
  Globe,
  HelpCircle,
  Lock,
  Plus,
  RefreshCw,
  Server,
  Terminal,
  Trash2,
  Users,
  Zap,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { McpConnectionState, McpProject, McpProvider, McpScope, McpServerConnectionStatus, ProviderMcpServer } from '@/shared/types';
import { IS_PLATFORM } from '@/shared/utils';
import { ActionMenu, Badge, Button } from '@/shared/ui';
import { MCP_GLOBAL_SUPPORTED_TRANSPORTS, MCP_PROVIDER_NAMES } from '@/shared/constants';
import { useMcpServers } from '@/modules/mcp/hooks/useMcpServers';
import { getMcpServerIdentity, maskSecret } from '@/modules/mcp/utils/mcpFormatting';
import McpServerFormModal from '@/modules/mcp/McpServerFormModal';

type McpServersProps = {
  selectedProvider: McpProvider;
  currentProjects: McpProject[];
};

const MCP_GLOBAL_SUPPORTED_SCOPES: McpScope[] = ['user', 'project'];

const MCP_PROVIDER_BUTTON_CLASSES: Record<McpProvider, string> = {
  claude: 'bg-primary text-primary-foreground hover:bg-primary/90',
  cursor: 'bg-primary text-primary-foreground hover:bg-primary/90',
  codex: 'bg-primary text-primary-foreground hover:bg-primary/90',
  opencode: 'bg-primary text-primary-foreground hover:bg-primary/90',
};

const getTransportIcon = (transport: string | undefined) => {
  if (transport === 'stdio') {
    return <Terminal className="h-4 w-4" />;
  }

  if (transport === 'sse') {
    return <Zap className="h-4 w-4" />;
  }

  if (transport === 'http') {
    return <Globe className="h-4 w-4" />;
  }

  return <Server className="h-4 w-4" />;
};

const getScopeLabel = (scope: McpScope): string => {
  if (scope === 'user') {
    return 'user';
  }

  if (scope === 'local') {
    return 'local';
  }

  return 'project';
};

// Icon and Tailwind tone per connection state. `unknown` stays deliberately
// neutral: it means the server was never contacted, not that it is broken.
const MCP_STATUS_PRESENTATION: Record<McpConnectionState, { icon: typeof Server; className: string }> = {
  connected: {
    icon: CheckCircle2,
    className: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  },
  failed: {
    icon: AlertCircle,
    className: 'border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300',
  },
  pending: {
    icon: CircleDashed,
    className: 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300',
  },
  unknown: {
    icon: HelpCircle,
    className: 'border-border bg-muted/40 text-muted-foreground',
  },
};

// Servers prefixed with `cloudcli-` are written and removed automatically by a
// CloudCLI feature toggle (e.g. the Browser tab), not added by the user. They are
// shown read-only so users don't edit/delete them out of sync with the feature.
const isManagedServer = (server: ProviderMcpServer): boolean => server.name.startsWith('cloudcli-');

function McpStatusBadge({ state }: { state: McpConnectionState }) {
  const { t } = useTranslation('settings');
  const { icon: Icon, className } = MCP_STATUS_PRESENTATION[state];

  return (
    <Badge variant="outline" className={`gap-1 text-xs ${className}`} data-mcp-status={state}>
      <Icon className="h-3 w-3" />
      {t(`mcpServers.connection.state.${state}`)}
    </Badge>
  );
}

function ConfigLine({ label, children }: { label: string; children: string }) {
  if (!children) {
    return null;
  }

  return (
    <div>
      {label}:{' '}
      <code className="rounded bg-muted px-1 text-xs">{children}</code>
    </div>
  );
}

function TeamMcpFeatureCard() {
  const { t } = useTranslation('settings');
  return (
    <div className="rounded-xl border border-dashed border-border/60 bg-muted/20 p-5">
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-muted/60 text-muted-foreground">
          <Users className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h4 className="text-sm font-medium text-foreground">{t('mcpTeamCard.title')}</h4>
            <Lock className="h-3 w-3 text-muted-foreground/60" />
          </div>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            {t('mcpTeamCard.description')}
          </p>
          <a
            href="https://cloudcli.ai"
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-primary transition-colors hover:underline"
          >
            {t('mcpTeamCard.proLink')}
            <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      </div>
    </div>
  );
}

/** Rendered by the settings module's agents tab to list and manage one provider's MCP servers. */
export default function McpServers({ selectedProvider, currentProjects }: McpServersProps) {
  const { t } = useTranslation('settings');
  const {
    servers,
    isLoading,
    isLoadingProjectScopes,
    loadError,
    deleteError,
    saveStatus,
    serverForm,
    serverStatuses,
    isCheckingStatuses,
    statusNotice,
    checkStatuses,
    openForm,
    openGlobalForm,
    closeForm,
    submitForm,
    submitGlobalForm,
    deleteServer,
  } = useMcpServers({ selectedProvider, currentProjects });

  const providerName = MCP_PROVIDER_NAMES[selectedProvider];
  const description = t(`mcpServers.description.${selectedProvider}`, {
    defaultValue: `Model Context Protocol servers provide additional tools and data sources to ${providerName}`,
  });
  const globalButtonLabel = t('mcpServersAdd.globalButtonLabel');
  const providerButtonLabel = t('mcpServersAdd.providerButtonLabel', { provider: providerName });
  const globalAddDescription = t('mcpServersAdd.globalAddDescription');
  const providerAddDescription = t('mcpServersAdd.providerAddDescription', { button: providerButtonLabel, provider: providerName });
  const globalModalDescription = t('mcpServersAdd.globalModalDescription');

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <Server className="mt-0.5 h-5 w-5 flex-shrink-0 text-purple-500" />
          <div className="min-w-0 space-y-1">
            <h3 className="text-lg font-medium text-foreground">{t('mcpServers.title')}</h3>
            <p className="text-sm text-muted-foreground">{description}</p>
          </div>
        </div>
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void checkStatuses()}
            disabled={isCheckingStatuses || servers.length === 0}
            className="w-full sm:w-auto"
            title={t('mcpServers.connection.checkHint')}
          >
            <RefreshCw className={`h-4 w-4 ${isCheckingStatuses ? 'animate-spin' : ''}`} />
            {isCheckingStatuses ? t('mcpServers.connection.checking') : t('mcpServers.connection.check')}
          </Button>
          <ActionMenu
            label={t('mcpServersAdd.menuLabel')}
            icon={Plus}
            className="w-full sm:w-auto"
            triggerClassName={`w-full sm:w-auto ${MCP_PROVIDER_BUTTON_CLASSES[selectedProvider]}`}
            items={[
              {
                key: 'global',
                label: globalButtonLabel,
                description: globalAddDescription,
                icon: Globe,
                onSelect: openGlobalForm,
              },
              {
                key: 'provider',
                label: providerButtonLabel,
                description: providerAddDescription,
                icon: Server,
                onSelect: () => openForm(),
              },
            ]}
          />
        </div>
      </div>

      <div className="space-y-2">
        <div className="min-h-4">
          {saveStatus === 'success' && (
            <span className="animate-in fade-in text-xs text-muted-foreground">{t('saveStatus.success')}</span>
          )}
          {isLoadingProjectScopes && (
            <span className="animate-in fade-in text-xs text-muted-foreground">{t('mcpServersAdd.refreshingScopes')}</span>
          )}
        </div>
      </div>

      {statusNotice && (
        <div className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
          {statusNotice.kind === 'unsupported'
            ? t('mcpServers.connection.unsupported', { provider: providerName })
            : t('mcpServers.connection.checkFailed', { details: statusNotice.message || '' })}
        </div>
      )}

      {(loadError || deleteError) && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800/60 dark:bg-red-900/20 dark:text-red-200">
          {deleteError || loadError}
        </div>
      )}

      <div className="space-y-2">
        {isLoading && servers.length === 0 && (
          <div className="py-8 text-center text-muted-foreground">{t('mcpServersAdd.loadingServers')}</div>
        )}

        {servers.map((server) => {
          const managed = isManagedServer(server);
          const status: McpServerConnectionStatus | undefined = serverStatuses.get(getMcpServerIdentity(server));

          return (
            <div key={getMcpServerIdentity(server)} className="rounded-lg border border-border bg-card/50 p-4">
              <div className="flex items-start justify-between">
                <div className="min-w-0 flex-1">
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    {!managed && getTransportIcon(server.transport)}
                    <span className="font-medium text-foreground">{server.name}</span>
                    {!managed && (
                      <>
                        <Badge variant="outline" className="text-xs">
                          {server.transport || 'stdio'}
                        </Badge>
                        <Badge variant="outline" className="text-xs">
                          {getScopeLabel(server.scope)}
                        </Badge>
                        {server.projectDisplayName && (
                          <Badge variant="outline" className="max-w-full truncate text-xs">
                            {server.projectDisplayName}
                          </Badge>
                        )}
                        {status && <McpStatusBadge state={status.state} />}
                      </>
                    )}
                    {managed && (
                      <Badge variant="outline" className="gap-1 text-xs text-muted-foreground">
                        <Lock className="h-3 w-3" />
                        {t('mcpServers.managed.badge', { defaultValue: 'Managed' })}
                      </Badge>
                    )}
                  </div>

                  <div className="space-y-1 text-sm text-muted-foreground">
                    {!managed && (
                      <>
                        <ConfigLine label={t('mcpServers.config.command')}>{server.command || ''}</ConfigLine>
                        <ConfigLine label={t('mcpServers.config.url')}>{server.url || ''}</ConfigLine>
                        <ConfigLine label={t('mcpServers.config.args')}>{(server.args || []).join(' ')}</ConfigLine>
                        <ConfigLine label={t('mcpServersAdd.configCwd')}>{server.cwd || ''}</ConfigLine>
                        {server.env && Object.keys(server.env).length > 0 && (
                          <ConfigLine label={t('mcpServers.config.environment')}>
                            {Object.entries(server.env).map(([key, value]) => `${key}=${maskSecret(value)}`).join(', ')}
                          </ConfigLine>
                        )}
                        {server.envVars && server.envVars.length > 0 && (
                          <ConfigLine label={t('mcpServersAdd.configEnvVars')}>{server.envVars.join(', ')}</ConfigLine>
                        )}
                        {status?.detail && (
                          <p className="text-xs leading-5 text-muted-foreground">{status.detail}</p>
                        )}
                      </>
                    )}
                    {managed && (
                      <div className="text-xs text-muted-foreground">
                        {t('mcpServers.managed.hint', {
                          defaultValue: 'Managed by CloudCLI.',
                        })}
                      </div>
                    )}
                  </div>
                </div>

                {!managed && (
                  <div className="ml-4 flex items-center gap-2">
                    <Button
                      onClick={() => openForm(server)}
                      variant="ghost"
                      size="sm"
                      className="text-muted-foreground hover:text-foreground"
                      title={t('mcpServers.actions.edit')}
                    >
                      <Edit3 className="h-4 w-4" />
                    </Button>
                    <Button
                      onClick={() => deleteServer(server)}
                      variant="ghost"
                      size="sm"
                      className="text-red-600 hover:text-red-700"
                      title={t('mcpServers.actions.delete')}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {!isLoading && !isLoadingProjectScopes && servers.length === 0 && (
          <div className="py-8 text-center text-muted-foreground">{t('mcpServers.empty')}</div>
        )}
      </div>

      {selectedProvider === 'codex' && (
        <div className="rounded-lg border border-border bg-muted/50 p-4">
          <h4 className="mb-2 font-medium text-foreground">{t('mcpServers.help.title')}</h4>
          <p className="text-sm text-muted-foreground">{t('mcpServers.help.description')}</p>
        </div>
      )}

      {selectedProvider === 'claude' && !IS_PLATFORM && <TeamMcpFeatureCard />}

      {/* Mounted only while open: each instance runs a full useMcpServerForm. */}
      {serverForm?.scope === 'provider' && (
        <McpServerFormModal
          provider={selectedProvider}
          editingServer={serverForm.editingServer}
          currentProjects={currentProjects}
          title={serverForm.editingServer ? undefined : providerButtonLabel}
          submitLabel={providerButtonLabel}
          onClose={closeForm}
          onSubmit={submitForm}
        />
      )}

      {serverForm?.scope === 'global' && (
        <McpServerFormModal
          provider={selectedProvider}
          mode="global"
          editingServer={null}
          currentProjects={currentProjects}
          title={globalButtonLabel}
          description={globalModalDescription}
          submitLabel={globalButtonLabel}
          supportedScopes={MCP_GLOBAL_SUPPORTED_SCOPES}
          supportedTransports={MCP_GLOBAL_SUPPORTED_TRANSPORTS}
          onClose={closeForm}
          onSubmit={(formData) => submitGlobalForm(formData)}
        />
      )}
    </div>
  );
}
