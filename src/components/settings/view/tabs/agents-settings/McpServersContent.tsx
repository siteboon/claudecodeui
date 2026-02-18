import { Edit3, Globe, Plus, Server, Terminal, Trash2, Zap } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Badge } from '../../../../ui/badge';
import { Button } from '../../../../ui/button';
import type { McpServer, McpToolsResult, McpTestResult } from '../../../types/types';

const getTransportIcon = (type: string | undefined) => {
  if (type === 'stdio') {
    return <Terminal className="w-4 h-4" />;
  }

  if (type === 'sse') {
    return <Zap className="w-4 h-4" />;
  }

  if (type === 'http') {
    return <Globe className="w-4 h-4" />;
  }

  return <Server className="w-4 h-4" />;
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
};

function ClaudeMcpServers({
  servers,
  onAdd,
  onEdit,
  onDelete,
  testResults,
  serverTools,
}: Omit<ClaudeMcpServersProps, 'agent' | 'onTest' | 'onDiscoverTools' | 'toolsLoading'>) {
  const { t } = useTranslation('settings');

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Server className="w-5 h-5 text-purple-500" />
        <h3 className="text-lg font-medium text-foreground">{t('mcpServers.title')}</h3>
      </div>
      <p className="text-sm text-muted-foreground">{t('mcpServers.description.claude')}</p>

      <div className="flex justify-between items-center">
        <Button onClick={onAdd} className="bg-purple-600 hover:bg-purple-700 text-white" size="sm">
          <Plus className="w-4 h-4 mr-2" />
          {t('mcpServers.addButton')}
        </Button>
      </div>

      <div className="space-y-2">
        {servers.map((server) => {
          const serverId = server.id || server.name;
          const testResult = testResults[serverId];
          const toolsResult = serverTools[serverId];

          return (
            <div key={serverId} className="bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-2">
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

                  <div className="text-sm text-muted-foreground space-y-1">
                    {server.type === 'stdio' && server.config?.command && (
                      <div>
                        {t('mcpServers.config.command')}:{' '}
                        <code className="bg-gray-100 dark:bg-gray-800 px-1 rounded text-xs">{server.config.command}</code>
                      </div>
                    )}
                    {(server.type === 'sse' || server.type === 'http') && server.config?.url && (
                      <div>
                        {t('mcpServers.config.url')}:{' '}
                        <code className="bg-gray-100 dark:bg-gray-800 px-1 rounded text-xs">{server.config.url}</code>
                      </div>
                    )}
                    {server.config?.args && server.config.args.length > 0 && (
                      <div>
                        {t('mcpServers.config.args')}:{' '}
                        <code className="bg-gray-100 dark:bg-gray-800 px-1 rounded text-xs">{server.config.args.join(' ')}</code>
                      </div>
                    )}
                  </div>

                  {testResult && (
                    <div className={`mt-2 p-2 rounded text-xs ${
                      testResult.success
                        ? 'bg-green-50 dark:bg-green-900/20 text-green-800 dark:text-green-200'
                        : 'bg-red-50 dark:bg-red-900/20 text-red-800 dark:text-red-200'
                    }`}
                    >
                      <div className="font-medium">{testResult.message}</div>
                    </div>
                  )}

                  {toolsResult && toolsResult.tools && toolsResult.tools.length > 0 && (
                    <div className="mt-2 p-2 rounded text-xs bg-blue-50 dark:bg-blue-900/20 text-blue-800 dark:text-blue-200">
                      <div className="font-medium">
                        {t('mcpServers.tools.title')} {t('mcpServers.tools.count', { count: toolsResult.tools.length })}
                      </div>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {toolsResult.tools.slice(0, 5).map((tool, index) => (
                          <code key={`${tool.name}-${index}`} className="bg-blue-100 dark:bg-blue-800 px-1 rounded">
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

                <div className="flex items-center gap-2 ml-4">
                  <Button
                    onClick={() => onEdit(server)}
                    variant="ghost"
                    size="sm"
                    className="text-gray-600 hover:text-gray-700"
                    title={t('mcpServers.actions.edit')}
                  >
                    <Edit3 className="w-4 h-4" />
                  </Button>
                  <Button
                    onClick={() => onDelete(serverId, server.scope)}
                    variant="ghost"
                    size="sm"
                    className="text-red-600 hover:text-red-700"
                    title={t('mcpServers.actions.delete')}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            </div>
          );
        })}
        {servers.length === 0 && (
          <div className="text-center py-8 text-gray-500 dark:text-gray-400">{t('mcpServers.empty')}</div>
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
        <Server className="w-5 h-5 text-purple-500" />
        <h3 className="text-lg font-medium text-foreground">{t('mcpServers.title')}</h3>
      </div>
      <p className="text-sm text-muted-foreground">{t('mcpServers.description.cursor')}</p>

      <div className="flex justify-between items-center">
        <Button onClick={onAdd} className="bg-purple-600 hover:bg-purple-700 text-white" size="sm">
          <Plus className="w-4 h-4 mr-2" />
          {t('mcpServers.addButton')}
        </Button>
      </div>

      <div className="space-y-2">
        {servers.map((server) => {
          const serverId = server.id || server.name;

          return (
            <div key={serverId} className="bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-2">
                    <Terminal className="w-4 h-4" />
                    <span className="font-medium text-foreground">{server.name}</span>
                    <Badge variant="outline" className="text-xs">stdio</Badge>
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {server.config?.command && (
                      <div>
                        {t('mcpServers.config.command')}:{' '}
                        <code className="bg-gray-100 dark:bg-gray-800 px-1 rounded text-xs">{server.config.command}</code>
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 ml-4">
                  <Button
                    onClick={() => onEdit(server)}
                    variant="ghost"
                    size="sm"
                    className="text-gray-600 hover:text-gray-700"
                    title={t('mcpServers.actions.edit')}
                  >
                    <Edit3 className="w-4 h-4" />
                  </Button>
                  <Button
                    onClick={() => onDelete(serverId)}
                    variant="ghost"
                    size="sm"
                    className="text-red-600 hover:text-red-700"
                    title={t('mcpServers.actions.delete')}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            </div>
          );
        })}
        {servers.length === 0 && (
          <div className="text-center py-8 text-gray-500 dark:text-gray-400">{t('mcpServers.empty')}</div>
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
};

function CodexMcpServers({ servers, onAdd, onEdit, onDelete }: Omit<CodexMcpServersProps, 'agent'>) {
  const { t } = useTranslation('settings');

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Server className="w-5 h-5 text-gray-700 dark:text-gray-300" />
        <h3 className="text-lg font-medium text-foreground">{t('mcpServers.title')}</h3>
      </div>
      <p className="text-sm text-muted-foreground">{t('mcpServers.description.codex')}</p>

      <div className="flex justify-between items-center">
        <Button onClick={onAdd} className="bg-gray-800 hover:bg-gray-900 dark:bg-gray-700 dark:hover:bg-gray-600 text-white" size="sm">
          <Plus className="w-4 h-4 mr-2" />
          {t('mcpServers.addButton')}
        </Button>
      </div>

      <div className="space-y-2">
        {servers.map((server) => (
          <div key={server.name} className="bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-2">
                  <Terminal className="w-4 h-4" />
                  <span className="font-medium text-foreground">{server.name}</span>
                  <Badge variant="outline" className="text-xs">stdio</Badge>
                </div>

                <div className="text-sm text-muted-foreground space-y-1">
                  {server.config?.command && (
                    <div>
                      {t('mcpServers.config.command')}:{' '}
                      <code className="bg-gray-100 dark:bg-gray-800 px-1 rounded text-xs">{server.config.command}</code>
                    </div>
                  )}
                  {server.config?.args && server.config.args.length > 0 && (
                    <div>
                      {t('mcpServers.config.args')}:{' '}
                      <code className="bg-gray-100 dark:bg-gray-800 px-1 rounded text-xs">{server.config.args.join(' ')}</code>
                    </div>
                  )}
                  {server.config?.env && Object.keys(server.config.env).length > 0 && (
                    <div>
                      {t('mcpServers.config.environment')}:{' '}
                      <code className="bg-gray-100 dark:bg-gray-800 px-1 rounded text-xs">
                        {Object.entries(server.config.env).map(([key, value]) => `${key}=${value}`).join(', ')}
                      </code>
                    </div>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2 ml-4">
                <Button
                  onClick={() => onEdit(server)}
                  variant="ghost"
                  size="sm"
                  className="text-gray-600 hover:text-gray-700"
                  title={t('mcpServers.actions.edit')}
                >
                  <Edit3 className="w-4 h-4" />
                </Button>
                <Button
                  onClick={() => onDelete(server.name)}
                  variant="ghost"
                  size="sm"
                  className="text-red-600 hover:text-red-700"
                  title={t('mcpServers.actions.delete')}
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            </div>
          </div>
        ))}
        {servers.length === 0 && (
          <div className="text-center py-8 text-gray-500 dark:text-gray-400">{t('mcpServers.empty')}</div>
        )}
      </div>

      <div className="bg-gray-100 dark:bg-gray-800/50 border border-gray-300 dark:border-gray-600 rounded-lg p-4">
        <h4 className="font-medium text-gray-900 dark:text-gray-100 mb-2">{t('mcpServers.help.title')}</h4>
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
