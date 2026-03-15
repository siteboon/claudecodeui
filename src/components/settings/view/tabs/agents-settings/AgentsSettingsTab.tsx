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
  copilotAuthStatus,
  onClaudeLogin,
  onCursorLogin,
  onCodexLogin,
  onGeminiLogin,
  onCopilotLogin,
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
    copilot: {
      authStatus: copilotAuthStatus,
      onLogin: onCopilotLogin,
    },
  }), [
    claudeAuthStatus,
    codexAuthStatus,
    cursorAuthStatus,
    geminiAuthStatus,
    copilotAuthStatus,
    onClaudeLogin,
    onCodexLogin,
    onCursorLogin,
    onGeminiLogin,
    onCopilotLogin,
  ]);

  return (
    <div className="-mx-4 -mb-4 -mt-2 flex min-h-[300px] flex-col overflow-hidden md:-mx-6 md:-mb-6 md:-mt-2 md:min-h-[500px]">
      <AgentSelectorSection
        selectedAgent={selectedAgent}
        onSelectAgent={setSelectedAgent}
        agentContextById={agentContextById}
      />

      <div className="flex flex-1 flex-col overflow-hidden">
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
