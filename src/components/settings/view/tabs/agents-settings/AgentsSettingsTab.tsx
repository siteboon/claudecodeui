import { useMemo, useState } from 'react';
import type { AgentCategory, AgentProvider } from '../../../types/types';
import AgentCategoryContentSection from './sections/AgentCategoryContentSection';
import AgentCategoryTabsSection from './sections/AgentCategoryTabsSection';
import AgentSelectorSection from './sections/AgentSelectorSection';
import type { AgentContext, AgentsSettingsTabProps } from './types';

export default function AgentsSettingsTab({
  claudeAuthStatus,
  cursorAuthStatus,
  codexAuthStatus,
  geminiAuthStatus,
  onClaudeLogin,
  onCursorLogin,
  onCodexLogin,
  onGeminiLogin,
  claudePermissions,
  onClaudePermissionsChange,
  cursorPermissions,
  onCursorPermissionsChange,
  codexPermissionMode,
  onCodexPermissionModeChange,
  geminiPermissionMode,
  onGeminiPermissionModeChange,
  mcpServers,
  cursorMcpServers,
  codexMcpServers,
  mcpTestResults,
  mcpServerTools,
  mcpToolsLoading,
  deleteError,
  onOpenMcpForm,
  onDeleteMcpServer,
  onTestMcpServer,
  onDiscoverMcpTools,
  onOpenCodexMcpForm,
  onDeleteCodexMcpServer,
}: AgentsSettingsTabProps) {
  const [selectedAgent, setSelectedAgent] = useState<AgentProvider>('claude');
  const [selectedCategory, setSelectedCategory] = useState<AgentCategory>('account');

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
    gemini: {
      authStatus: geminiAuthStatus,
      onLogin: onGeminiLogin,
    },
  }), [
    claudeAuthStatus,
    codexAuthStatus,
    cursorAuthStatus,
    geminiAuthStatus,
    onClaudeLogin,
    onCodexLogin,
    onCursorLogin,
    onGeminiLogin,
  ]);

  return (
    <div className="flex flex-col md:flex-row h-full min-h-[400px] md:min-h-[500px]">
      <AgentSelectorSection
        selectedAgent={selectedAgent}
        onSelectAgent={setSelectedAgent}
        agentContextById={agentContextById}
      />

      <div className="flex-1 flex flex-col overflow-hidden">
        <AgentCategoryTabsSection
          selectedCategory={selectedCategory}
          onSelectCategory={setSelectedCategory}
        />

        <AgentCategoryContentSection
          selectedAgent={selectedAgent}
          selectedCategory={selectedCategory}
          agentContextById={agentContextById}
          claudePermissions={claudePermissions}
          onClaudePermissionsChange={onClaudePermissionsChange}
          cursorPermissions={cursorPermissions}
          onCursorPermissionsChange={onCursorPermissionsChange}
          codexPermissionMode={codexPermissionMode}
          onCodexPermissionModeChange={onCodexPermissionModeChange}
          geminiPermissionMode={geminiPermissionMode}
          onGeminiPermissionModeChange={onGeminiPermissionModeChange}
          mcpServers={mcpServers}
          cursorMcpServers={cursorMcpServers}
          codexMcpServers={codexMcpServers}
          mcpTestResults={mcpTestResults}
          mcpServerTools={mcpServerTools}
          mcpToolsLoading={mcpToolsLoading}
          deleteError={deleteError}
          onOpenMcpForm={onOpenMcpForm}
          onDeleteMcpServer={onDeleteMcpServer}
          onTestMcpServer={onTestMcpServer}
          onDiscoverMcpTools={onDiscoverMcpTools}
          onOpenCodexMcpForm={onOpenCodexMcpForm}
          onDeleteCodexMcpServer={onDeleteCodexMcpServer}
        />
      </div>
    </div>
  );
}
