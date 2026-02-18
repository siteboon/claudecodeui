import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import AgentListItem from './AgentListItem';
import AccountContent from './AccountContent';
import McpServersContent from './McpServersContent';
import PermissionsContent from './PermissionsContent';
import type {
  AgentCategory,
  AgentProvider,
  AuthStatus,
  ClaudePermissionsState,
  CodexPermissionMode,
  CursorPermissionsState,
  McpServer,
  McpToolsResult,
  McpTestResult,
} from '../../../types/types';

type AgentsSettingsTabProps = {
  claudeAuthStatus: AuthStatus;
  cursorAuthStatus: AuthStatus;
  codexAuthStatus: AuthStatus;
  onClaudeLogin: () => void;
  onCursorLogin: () => void;
  onCodexLogin: () => void;
  claudePermissions: ClaudePermissionsState;
  onClaudePermissionsChange: (value: ClaudePermissionsState) => void;
  cursorPermissions: CursorPermissionsState;
  onCursorPermissionsChange: (value: CursorPermissionsState) => void;
  codexPermissionMode: CodexPermissionMode;
  onCodexPermissionModeChange: (value: CodexPermissionMode) => void;
  mcpServers: McpServer[];
  cursorMcpServers: McpServer[];
  codexMcpServers: McpServer[];
  mcpTestResults: Record<string, McpTestResult>;
  mcpServerTools: Record<string, McpToolsResult>;
  mcpToolsLoading: Record<string, boolean>;
  onOpenMcpForm: (server?: McpServer) => void;
  onDeleteMcpServer: (serverId: string, scope?: string) => void;
  onTestMcpServer: (serverId: string, scope?: string) => void;
  onDiscoverMcpTools: (serverId: string, scope?: string) => void;
  onOpenCodexMcpForm: (server?: McpServer) => void;
  onDeleteCodexMcpServer: (serverId: string) => void;
};

type AgentContext = {
  authStatus: AuthStatus;
  onLogin: () => void;
};

export default function AgentsSettingsTab({
  claudeAuthStatus,
  cursorAuthStatus,
  codexAuthStatus,
  onClaudeLogin,
  onCursorLogin,
  onCodexLogin,
  claudePermissions,
  onClaudePermissionsChange,
  cursorPermissions,
  onCursorPermissionsChange,
  codexPermissionMode,
  onCodexPermissionModeChange,
  mcpServers,
  cursorMcpServers,
  codexMcpServers,
  mcpTestResults,
  mcpServerTools,
  mcpToolsLoading,
  onOpenMcpForm,
  onDeleteMcpServer,
  onTestMcpServer,
  onDiscoverMcpTools,
  onOpenCodexMcpForm,
  onDeleteCodexMcpServer,
}: AgentsSettingsTabProps) {
  const { t } = useTranslation('settings');
  const [selectedAgent, setSelectedAgent] = useState<AgentProvider>('claude');
  const [selectedCategory, setSelectedCategory] = useState<AgentCategory>('account');
  // Cursor MCP add/edit/delete was previously a placeholder and is intentionally preserved.
  const noopCursorMcpAction = () => {};

  const agentContextById = useMemo<Record<AgentProvider, AgentContext>>(() => ({
    claude: {
      authStatus: claudeAuthStatus,
      onLogin: onClaudeLogin,
    },
    cursor: {
      authStatus: cursorAuthStatus,
      onLogin: onCursorLogin,
    },
    codex: {
      authStatus: codexAuthStatus,
      onLogin: onCodexLogin,
    },
  }), [
    claudeAuthStatus,
    codexAuthStatus,
    cursorAuthStatus,
    onClaudeLogin,
    onCodexLogin,
    onCursorLogin,
  ]);

  return (
    <div className="flex flex-col md:flex-row h-full min-h-[400px] md:min-h-[500px]">
      <div className="md:hidden border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
        <div className="flex">
          {(['claude', 'cursor', 'codex'] as AgentProvider[]).map((agent) => (
            <AgentListItem
              key={`mobile-${agent}`}
              agentId={agent}
              authStatus={agentContextById[agent].authStatus}
              isSelected={selectedAgent === agent}
              onClick={() => setSelectedAgent(agent)}
              isMobile
            />
          ))}
        </div>
      </div>

      <div className="hidden md:block w-48 border-r border-gray-200 dark:border-gray-700 flex-shrink-0">
        <div className="p-2">
          {(['claude', 'cursor', 'codex'] as AgentProvider[]).map((agent) => (
            <AgentListItem
              key={`desktop-${agent}`}
              agentId={agent}
              authStatus={agentContextById[agent].authStatus}
              isSelected={selectedAgent === agent}
              onClick={() => setSelectedAgent(agent)}
            />
          ))}
        </div>
      </div>

      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
          <div className="flex px-2 md:px-4 overflow-x-auto">
            {(['account', 'permissions', 'mcp'] as AgentCategory[]).map((category) => (
              <button
                key={category}
                onClick={() => setSelectedCategory(category)}
                className={`px-3 md:px-4 py-2 md:py-3 text-xs md:text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                  selectedCategory === category
                    ? 'border-blue-600 text-blue-600 dark:text-blue-400'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}
              >
                {category === 'account' && t('tabs.account')}
                {category === 'permissions' && t('tabs.permissions')}
                {category === 'mcp' && t('tabs.mcpServers')}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-3 md:p-4">
          {selectedCategory === 'account' && (
            <AccountContent
              agent={selectedAgent}
              authStatus={agentContextById[selectedAgent].authStatus}
              onLogin={agentContextById[selectedAgent].onLogin}
            />
          )}

          {selectedCategory === 'permissions' && selectedAgent === 'claude' && (
            <PermissionsContent
              agent="claude"
              skipPermissions={claudePermissions.skipPermissions}
              onSkipPermissionsChange={(value) => {
                onClaudePermissionsChange({ ...claudePermissions, skipPermissions: value });
              }}
              allowedTools={claudePermissions.allowedTools}
              onAllowedToolsChange={(value) => {
                onClaudePermissionsChange({ ...claudePermissions, allowedTools: value });
              }}
              disallowedTools={claudePermissions.disallowedTools}
              onDisallowedToolsChange={(value) => {
                onClaudePermissionsChange({ ...claudePermissions, disallowedTools: value });
              }}
            />
          )}

          {selectedCategory === 'permissions' && selectedAgent === 'cursor' && (
            <PermissionsContent
              agent="cursor"
              skipPermissions={cursorPermissions.skipPermissions}
              onSkipPermissionsChange={(value) => {
                onCursorPermissionsChange({ ...cursorPermissions, skipPermissions: value });
              }}
              allowedCommands={cursorPermissions.allowedCommands}
              onAllowedCommandsChange={(value) => {
                onCursorPermissionsChange({ ...cursorPermissions, allowedCommands: value });
              }}
              disallowedCommands={cursorPermissions.disallowedCommands}
              onDisallowedCommandsChange={(value) => {
                onCursorPermissionsChange({ ...cursorPermissions, disallowedCommands: value });
              }}
            />
          )}

          {selectedCategory === 'permissions' && selectedAgent === 'codex' && (
            <PermissionsContent
              agent="codex"
              permissionMode={codexPermissionMode}
              onPermissionModeChange={onCodexPermissionModeChange}
            />
          )}

          {selectedCategory === 'mcp' && selectedAgent === 'claude' && (
            <McpServersContent
              agent="claude"
              servers={mcpServers}
              onAdd={() => onOpenMcpForm()}
              onEdit={(server) => onOpenMcpForm(server)}
              onDelete={onDeleteMcpServer}
              onTest={onTestMcpServer}
              onDiscoverTools={onDiscoverMcpTools}
              testResults={mcpTestResults}
              serverTools={mcpServerTools}
              toolsLoading={mcpToolsLoading}
            />
          )}

          {selectedCategory === 'mcp' && selectedAgent === 'cursor' && (
            <McpServersContent
              agent="cursor"
              servers={cursorMcpServers}
              onAdd={noopCursorMcpAction}
              onEdit={noopCursorMcpAction}
              onDelete={noopCursorMcpAction}
            />
          )}

          {selectedCategory === 'mcp' && selectedAgent === 'codex' && (
            <McpServersContent
              agent="codex"
              servers={codexMcpServers}
              onAdd={() => onOpenCodexMcpForm()}
              onEdit={(server) => onOpenCodexMcpForm(server)}
              onDelete={(serverId) => onDeleteCodexMcpServer(serverId)}
            />
          )}
        </div>
      </div>
    </div>
  );
}
