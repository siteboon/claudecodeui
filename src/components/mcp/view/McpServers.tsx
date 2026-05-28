import { Edit3, ExternalLink, Globe, Lock, Plus, Server, Terminal, Trash2, Users, Zap } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { McpProject, McpProvider, McpScope, ProviderMcpServer } from '../types';
import { IS_PLATFORM } from '../../../constants/config';
import { Badge, Button } from '../../../shared/view/ui';
import {
  MCP_GLOBAL_SUPPORTED_SCOPES,
  MCP_GLOBAL_SUPPORTED_TRANSPORTS,
  MCP_PROVIDER_BUTTON_CLASSES,
  MCP_PROVIDER_NAMES,
} from '../constants';
import { useMcpServers } from '../hooks/useMcpServers';
import { maskSecret } from '../utils/mcpFormatting';

import McpServerFormModal from './modals/McpServerFormModal';

type McpServersProps = {
  selectedProvider: McpProvider;
  currentProjects: McpProject[];
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

const getServerKey = (server: ProviderMcpServer): string => (
  `${server.provider}:${server.scope}:${server.workspacePath || 'global'}:${server.name}`
);

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
  return (
    <div className="rounded-xl border border-dashed border-border/60 bg-muted/20 p-5">
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-muted/60 text-muted-foreground">
          <Users className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h4 className="text-sm font-medium text-foreground">Team MCP Configs</h4>
            <Lock className="h-3 w-3 text-muted-foreground/60" />
          </div>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            Share MCP server configurations across your team. Everyone stays in sync automatically.
          </p>
          <a
            href="https://cloudcli.ai"
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-primary transition-colors hover:underline"
          >
            Available with CloudCLI Pro
            <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      </div>
    </div>
  );
}

export default function McpServers({ selectedProvider, currentProjects }: McpServersProps) {
  const { t } = useTranslation('settings');
  const {
    servers,
    isLoading,
    isLoadingProjectScopes,
    loadError,
    deleteError,
    saveStatus,
    isFormOpen,
    isGlobalFormOpen,
    editingServer,
    openForm,
    openGlobalForm,
    closeForm,
    closeGlobalForm,
    submitForm,
    submitGlobalForm,
    deleteServer,
  } = useMcpServers({ selectedProvider, currentProjects });

  const providerName = MCP_PROVIDER_NAMES[selectedProvider];
  const description = t(`mcpServers.description.${selectedProvider}`, {
    defaultValue: `Model Context Protocol servers provide additional tools and data sources to ${providerName}`,
  });
  const globalButtonLabel = 'Add Global MCP Server';
  const providerButtonLabel = `Add ${providerName} MCP Server`;
  const globalAddDescription = 'Add Global MCP Server writes one common stdio or HTTP server to Claude, Cursor, Codex, and Gemini.';
  const providerAddDescription = `${providerButtonLabel} only changes ${providerName}.`;
  const globalModalDescription = 'Adds this MCP server to every provider: Claude, Cursor, Codex, and Gemini. '
    + 'Only stdio and HTTP transports are supported because the same config must work across all providers.';

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Server className="h-5 w-5 text-purple-500" />
        <h3 className="text-lg font-medium text-foreground">{t('mcpServers.title')}</h3>
      </div>
      <p className="text-sm text-muted-foreground">{description}</p>

      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            onClick={openGlobalForm}
            className={MCP_PROVIDER_BUTTON_CLASSES[selectedProvider]}
            size="sm"
            title={globalAddDescription}
          >
            <Plus className="mr-2 h-4 w-4" />
            {globalButtonLabel}
          </Button>
          <Button
            onClick={() => openForm()}
            variant="outline"
            size="sm"
            title={providerAddDescription}
          >
            <Plus className="mr-2 h-4 w-4" />
            {providerButtonLabel}
          </Button>
        </div>
        <div className="min-h-4">
          {saveStatus === 'success' && (
            <span className="animate-in fade-in text-xs text-muted-foreground">{t('saveStatus.success')}</span>
          )}
          {isLoadingProjectScopes && (
            <span className="animate-in fade-in text-xs text-muted-foreground">Refreshing project scopes...</span>
          )}
        </div>
      </div>

      {(loadError || deleteError) && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800/60 dark:bg-red-900/20 dark:text-red-200">
          {deleteError || loadError}
        </div>
      )}

      <div className="space-y-2">
        {isLoading && servers.length === 0 && (
          <div className="py-8 text-center text-muted-foreground">Loading MCP servers...</div>
        )}

        {servers.map((server) => (
          <div key={getServerKey(server)} className="rounded-lg border border-border bg-card/50 p-4">
            <div className="flex items-start justify-between">
              <div className="min-w-0 flex-1">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  {getTransportIcon(server.transport)}
                  <span className="font-medium text-foreground">{server.name}</span>
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
                </div>

                <div className="space-y-1 text-sm text-muted-foreground">
                  <ConfigLine label={t('mcpServers.config.command')}>{server.command || ''}</ConfigLine>
                  <ConfigLine label={t('mcpServers.config.url')}>{server.url || ''}</ConfigLine>
                  <ConfigLine label={t('mcpServers.config.args')}>{(server.args || []).join(' ')}</ConfigLine>
                  <ConfigLine label="Cwd">{server.cwd || ''}</ConfigLine>
                  {server.env && Object.keys(server.env).length > 0 && (
                    <ConfigLine label={t('mcpServers.config.environment')}>
                      {Object.entries(server.env).map(([key, value]) => `${key}=${maskSecret(value)}`).join(', ')}
                    </ConfigLine>
                  )}
                  {server.envVars && server.envVars.length > 0 && (
                    <ConfigLine label="Env Vars">{server.envVars.join(', ')}</ConfigLine>
                  )}
                </div>
              </div>

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
            </div>
          </div>
        ))}

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

      <McpServerFormModal
        provider={selectedProvider}
        isOpen={isFormOpen}
        editingServer={editingServer}
        currentProjects={currentProjects}
        title={editingServer ? undefined : providerButtonLabel}
        submitLabel={providerButtonLabel}
        onClose={closeForm}
        onSubmit={submitForm}
      />

      <McpServerFormModal
        provider={selectedProvider}
        mode="global"
        isOpen={isGlobalFormOpen}
        editingServer={null}
        currentProjects={currentProjects}
        title={globalButtonLabel}
        description={globalModalDescription}
        submitLabel={globalButtonLabel}
        supportedScopes={MCP_GLOBAL_SUPPORTED_SCOPES}
        supportedTransports={MCP_GLOBAL_SUPPORTED_TRANSPORTS}
        onClose={closeGlobalForm}
        onSubmit={(formData) => submitGlobalForm(formData)}
      />
    </div>
  );
}
