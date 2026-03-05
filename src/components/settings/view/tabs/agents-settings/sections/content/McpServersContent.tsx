import { Edit3, Globe, Plus, Server, Terminal, Trash2, Zap } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Badge, Button } from '../../../../../../../shared/view/ui';
import type { McpServer, McpToolsResult, McpTestResult } from '../../../../../types/types';

const getTransportIcon = (type: string | undefined) => {
  if (type === 'stdio') {
    return <Terminal className="h-4 w-4" />;
  }

  if (type === 'sse') {
    return <Zap className="h-4 w-4" />;
  }

  if (type === 'http') {
    return <Globe className="h-4 w-4" />;
  }

  return <Server className="h-4 w-4" />;
};

const maskSecret = (value: unknown): string => {
  const normalizedValue = String(value ?? '');
  if (normalizedValue.length <= 4) {
    return '****';
  }

  return `${normalizedValue.slice(0, 2)}****${normalizedValue.slice(-2)}`;
};

type ClaudeMcpServersProps = {
  agent: 'claude';
  servers: McpServer[];
  onAdd: () => void;
  onEdit: (server: McpServer) => void;
  onDelete: (serverId: string, scope?: string) => void;
  onTest: (serverId: string, scope?: string) => void;
  onDiscoverTools: (serverId: string, scope?: string) => void;
  testResults: Record<string, McpTestResult>;
  serverTools: Record<string, McpToolsResult>;
  toolsLoading: Record<string, boolean>;
  deleteError?: string | null;
};

function ClaudeMcpServers({
  servers,
  onAdd,
  onEdit,
  onDelete,
  testResults,
  serverTools,
  deleteError,
}: Omit<ClaudeMcpServersProps, 'agent' | 'onTest' | 'onDiscoverTools' | 'toolsLoading'>) {
  const { t } = useTranslation('settings');

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Server className="h-5 w-5 text-purple-500" />
        <h3 className="text-lg font-medium text-foreground">{t('mcpServers.title')}</h3>
      </div>
      <p className="text-sm text-muted-foreground">{t('mcpServers.description.claude')}</p>

      <div className="flex items-center justify-between">
        <Button onClick={onAdd} className="bg-purple-600 text-white hover:bg-purple-700" size="sm">
          <Plus className="mr-2 h-4 w-4" />
          {t('mcpServers.addButton')}
        </Button>
      </div>
      {deleteError && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800/60 dark:bg-red-900/20 dark:text-red-200">
          {deleteError}
        </div>
      )}

      <div className="space-y-2">
        {servers.map((server) => {
          const serverId = server.id || server.name;
          const testResult = testResults[serverId];
          const toolsResult = serverTools[serverId];

          return (
            <div key={serverId} className="rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-900/50">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="mb-2 flex items-center gap-2">
                    {getTransportIcon(server.type)}
                    <span className="font-medium text-foreground">{server.name}</span>
                    <Badge variant="outline" className="text-xs">
                      {server.type || 'stdio'}
                    </Badge>
                    <Badge variant="outline" className="text-xs">
                      {server.scope === 'local'
                        ? t('mcpServers.scope.local')
                        : server.scope === 'user'
                        ? t('mcpServers.scope.user')
                        : server.scope}
                    </Badge>
                  </div>

                  <div className="space-y-1 text-sm text-muted-foreground">
                    {server.type === 'stdio' && server.config?.command && (
                      <div>
                        {t('mcpServers.config.command')}:{' '}
                        <code className="rounded bg-gray-100 px-1 text-xs dark:bg-gray-800">{server.config.command}</code>
                      </div>
                    )}
                    {(server.type === 'sse' || server.type === 'http') && server.config?.url && (
                      <div>
                        {t('mcpServers.config.url')}:{' '}
                        <code className="rounded bg-gray-100 px-1 text-xs dark:bg-gray-800">{server.config.url}</code>
                      </div>
                    )}
                    {server.config?.args && server.config.args.length > 0 && (
                      <div>
                        {t('mcpServers.config.args')}:{' '}
                        <code className="rounded bg-gray-100 px-1 text-xs dark:bg-gray-800">{server.config.args.join(' ')}</code>
                      </div>
                    )}
                  </div>

                  {testResult && (
                    <div className={`mt-2 rounded p-2 text-xs ${
                      testResult.success
                        ? 'bg-green-50 text-green-800 dark:bg-green-900/20 dark:text-green-200'
                        : 'bg-red-50 text-red-800 dark:bg-red-900/20 dark:text-red-200'
                    }`}
                    >
                      <div className="font-medium">{testResult.message}</div>
                    </div>
                  )}

                  {toolsResult && toolsResult.tools && toolsResult.tools.length > 0 && (
                    <div className="mt-2 rounded bg-blue-50 p-2 text-xs text-blue-800 dark:bg-blue-900/20 dark:text-blue-200">
                      <div className="font-medium">
                        {t('mcpServers.tools.title')} {t('mcpServers.tools.count', { count: toolsResult.tools.length })}
                      </div>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {toolsResult.tools.slice(0, 5).map((tool, index) => (
                          <code key={`${tool.name}-${index}`} className="rounded bg-blue-100 px-1 dark:bg-blue-800">
                            {tool.name}
                          </code>
                        ))}
                        {toolsResult.tools.length > 5 && (
                          <span className="text-xs opacity-75">
                            {t('mcpServers.tools.more', { count: toolsResult.tools.length - 5 })}
                          </span>
                        )}
                      </div>
                    </div>
                  )}
                </div>

                <div className="ml-4 flex items-center gap-2">
                  <Button
                    onClick={() => onEdit(server)}
                    variant="ghost"
                    size="sm"
                    className="text-gray-600 hover:text-gray-700"
                    title={t('mcpServers.actions.edit')}
                  >
                    <Edit3 className="h-4 w-4" />
                  </Button>
                  <Button
                    onClick={() => onDelete(serverId, server.scope)}
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
          );
        })}
        {servers.length === 0 && (
          <div className="py-8 text-center text-gray-500 dark:text-gray-400">{t('mcpServers.empty')}</div>
        )}
      </div>
    </div>
  );
}

type CursorMcpServersProps = {
  agent: 'cursor';
  servers: McpServer[];
  onAdd: () => void;
  onEdit: (server: McpServer) => void;
  onDelete: (serverId: string) => void;
};

function CursorMcpServers({ servers, onAdd, onEdit, onDelete }: Omit<CursorMcpServersProps, 'agent'>) {
  const { t } = useTranslation('settings');

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Server className="h-5 w-5 text-purple-500" />
        <h3 className="text-lg font-medium text-foreground">{t('mcpServers.title')}</h3>
      </div>
      <p className="text-sm text-muted-foreground">{t('mcpServers.description.cursor')}</p>

      <div className="flex items-center justify-between">
        <Button onClick={onAdd} className="bg-purple-600 text-white hover:bg-purple-700" size="sm">
          <Plus className="mr-2 h-4 w-4" />
          {t('mcpServers.addButton')}
        </Button>
      </div>

      <div className="space-y-2">
        {servers.map((server) => {
          const serverId = server.id || server.name;

          return (
            <div key={serverId} className="rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-900/50">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="mb-2 flex items-center gap-2">
                    <Terminal className="h-4 w-4" />
                    <span className="font-medium text-foreground">{server.name}</span>
                    <Badge variant="outline" className="text-xs">stdio</Badge>
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {server.config?.command && (
                      <div>
                        {t('mcpServers.config.command')}:{' '}
                        <code className="rounded bg-gray-100 px-1 text-xs dark:bg-gray-800">{server.config.command}</code>
                      </div>
                    )}
                  </div>
                </div>
                <div className="ml-4 flex items-center gap-2">
                  <Button
                    onClick={() => onEdit(server)}
                    variant="ghost"
                    size="sm"
                    className="text-gray-600 hover:text-gray-700"
                    title={t('mcpServers.actions.edit')}
                  >
                    <Edit3 className="h-4 w-4" />
                  </Button>
                  <Button
                    onClick={() => onDelete(serverId)}
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
          );
        })}
        {servers.length === 0 && (
          <div className="py-8 text-center text-gray-500 dark:text-gray-400">{t('mcpServers.empty')}</div>
        )}
      </div>
    </div>
  );
}

type CodexMcpServersProps = {
  agent: 'codex';
  servers: McpServer[];
  onAdd: () => void;
  onEdit: (server: McpServer) => void;
  onDelete: (serverId: string) => void;
  deleteError?: string | null;
};

function CodexMcpServers({ servers, onAdd, onEdit, onDelete, deleteError }: Omit<CodexMcpServersProps, 'agent'>) {
  const { t } = useTranslation('settings');

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Server className="h-5 w-5 text-gray-700 dark:text-gray-300" />
        <h3 className="text-lg font-medium text-foreground">{t('mcpServers.title')}</h3>
      </div>
      <p className="text-sm text-muted-foreground">{t('mcpServers.description.codex')}</p>

      <div className="flex items-center justify-between">
        <Button onClick={onAdd} className="bg-gray-800 text-white hover:bg-gray-900 dark:bg-gray-700 dark:hover:bg-gray-600" size="sm">
          <Plus className="mr-2 h-4 w-4" />
          {t('mcpServers.addButton')}
        </Button>
      </div>
      {deleteError && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800/60 dark:bg-red-900/20 dark:text-red-200">
          {deleteError}
        </div>
      )}

      <div className="space-y-2">
        {servers.map((server) => (
          <div key={server.name} className="rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-900/50">
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <div className="mb-2 flex items-center gap-2">
                  <Terminal className="h-4 w-4" />
                  <span className="font-medium text-foreground">{server.name}</span>
                  <Badge variant="outline" className="text-xs">stdio</Badge>
                </div>

                <div className="space-y-1 text-sm text-muted-foreground">
                  {server.config?.command && (
                    <div>
                      {t('mcpServers.config.command')}:{' '}
                      <code className="rounded bg-gray-100 px-1 text-xs dark:bg-gray-800">{server.config.command}</code>
                    </div>
                  )}
                  {server.config?.args && server.config.args.length > 0 && (
                    <div>
                      {t('mcpServers.config.args')}:{' '}
                      <code className="rounded bg-gray-100 px-1 text-xs dark:bg-gray-800">{server.config.args.join(' ')}</code>
                    </div>
                  )}
                  {server.config?.env && Object.keys(server.config.env).length > 0 && (
                    <div>
                      {t('mcpServers.config.environment')}:{' '}
                      <code className="rounded bg-gray-100 px-1 text-xs dark:bg-gray-800">
                        {Object.entries(server.config.env).map(([key, value]) => `${key}=${maskSecret(value)}`).join(', ')}
                      </code>
                    </div>
                  )}
                </div>
              </div>

              <div className="ml-4 flex items-center gap-2">
                <Button
                  onClick={() => onEdit(server)}
                  variant="ghost"
                  size="sm"
                  className="text-gray-600 hover:text-gray-700"
                  title={t('mcpServers.actions.edit')}
                >
                  <Edit3 className="h-4 w-4" />
                </Button>
                <Button
                  onClick={() => onDelete(server.name)}
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
        {servers.length === 0 && (
          <div className="py-8 text-center text-gray-500 dark:text-gray-400">{t('mcpServers.empty')}</div>
        )}
      </div>

      <div className="rounded-lg border border-gray-300 bg-gray-100 p-4 dark:border-gray-600 dark:bg-gray-800/50">
        <h4 className="mb-2 font-medium text-gray-900 dark:text-gray-100">{t('mcpServers.help.title')}</h4>
        <p className="text-sm text-gray-700 dark:text-gray-300">{t('mcpServers.help.description')}</p>
      </div>
    </div>
  );
}

type McpServersContentProps = ClaudeMcpServersProps | CursorMcpServersProps | CodexMcpServersProps;

export default function McpServersContent(props: McpServersContentProps) {
  if (props.agent === 'claude') {
    return <ClaudeMcpServers {...props} />;
  }

  if (props.agent === 'cursor') {
    return <CursorMcpServers {...props} />;
  }

  return <CodexMcpServers {...props} />;
}
