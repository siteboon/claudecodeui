import { Settings as SettingsIcon, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import ProviderLoginModal from '../../provider-auth/view/ProviderLoginModal';
import { Button } from '../../../shared/view/ui';
import ClaudeMcpFormModal from '../view/modals/ClaudeMcpFormModal';
import CodexMcpFormModal from '../view/modals/CodexMcpFormModal';
import SettingsMainTabs from '../view/SettingsMainTabs';
import AgentsSettingsTab from '../view/tabs/agents-settings/AgentsSettingsTab';
import AppearanceSettingsTab from '../view/tabs/AppearanceSettingsTab';
import CredentialsSettingsTab from '../view/tabs/api-settings/CredentialsSettingsTab';
import GitSettingsTab from '../view/tabs/git-settings/GitSettingsTab';
import TasksSettingsTab from '../view/tabs/tasks-settings/TasksSettingsTab';
import { useSettingsController } from '../hooks/useSettingsController';
import type { SettingsProps } from '../types/types';

function Settings({ isOpen, onClose, projects = [], initialTab = 'agents' }: SettingsProps) {
  const { t } = useTranslation('settings');
  const {
    activeTab,
    setActiveTab,
    isSaving,
    saveStatus,
    deleteError,
    projectSortOrder,
    setProjectSortOrder,
    codeEditorSettings,
    updateCodeEditorSetting,
    claudePermissions,
    setClaudePermissions,
    cursorPermissions,
    setCursorPermissions,
    codexPermissionMode,
    setCodexPermissionMode,
    mcpServers,
    cursorMcpServers,
    codexMcpServers,
    mcpTestResults,
    mcpServerTools,
    mcpToolsLoading,
    showMcpForm,
    editingMcpServer,
    openMcpForm,
    closeMcpForm,
    submitMcpForm,
    handleMcpDelete,
    handleMcpTest,
    handleMcpToolsDiscovery,
    showCodexMcpForm,
    editingCodexMcpServer,
    openCodexMcpForm,
    closeCodexMcpForm,
    submitCodexMcpForm,
    handleCodexMcpDelete,
    claudeAuthStatus,
    cursorAuthStatus,
    codexAuthStatus,
    geminiAuthStatus,
    geminiPermissionMode,
    setGeminiPermissionMode,
    openLoginForProvider,
    showLoginModal,
    setShowLoginModal,
    loginProvider,
    selectedProject,
    handleLoginComplete,
    saveSettings,
  } = useSettingsController({
    isOpen,
    initialTab,
    projects,
    onClose,
  });

  if (!isOpen) {
    return null;
  }

  const isAuthenticated = loginProvider === 'claude'
    ? claudeAuthStatus.authenticated
    : loginProvider === 'cursor'
      ? cursorAuthStatus.authenticated
      : loginProvider === 'codex'
        ? codexAuthStatus.authenticated
        : false;

  return (
    <div className="modal-backdrop fixed inset-0 z-[9999] flex items-center justify-center bg-background/95 md:p-4">
      <div className="flex h-full w-full flex-col border border-border bg-background shadow-xl md:h-[90vh] md:max-w-4xl md:rounded-lg">
        <div className="flex flex-shrink-0 items-center justify-between border-b border-border p-4 md:p-6">
          <div className="flex items-center gap-3">
            <SettingsIcon className="h-5 w-5 text-blue-600 md:h-6 md:w-6" />
            <h2 className="text-lg font-semibold text-foreground md:text-xl">{t('title')}</h2>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            className="touch-manipulation text-muted-foreground hover:text-foreground"
          >
            <X className="h-5 w-5" />
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto">
          <SettingsMainTabs activeTab={activeTab} onChange={setActiveTab} />

          <div className="space-y-6 p-4 pb-safe-area-inset-bottom md:space-y-8 md:p-6">
            {activeTab === 'appearance' && (
              <AppearanceSettingsTab
                projectSortOrder={projectSortOrder}
                onProjectSortOrderChange={setProjectSortOrder}
                codeEditorSettings={codeEditorSettings}
                onCodeEditorThemeChange={(value) => updateCodeEditorSetting('theme', value)}
                onCodeEditorWordWrapChange={(value) => updateCodeEditorSetting('wordWrap', value)}
                onCodeEditorShowMinimapChange={(value) => updateCodeEditorSetting('showMinimap', value)}
                onCodeEditorLineNumbersChange={(value) => updateCodeEditorSetting('lineNumbers', value)}
                onCodeEditorFontSizeChange={(value) => updateCodeEditorSetting('fontSize', value)}
              />
            )}

            {activeTab === 'git' && <GitSettingsTab />}

            {activeTab === 'agents' && (
              <AgentsSettingsTab
                claudeAuthStatus={claudeAuthStatus}
                cursorAuthStatus={cursorAuthStatus}
                codexAuthStatus={codexAuthStatus}
                geminiAuthStatus={geminiAuthStatus}
                onClaudeLogin={() => openLoginForProvider('claude')}
                onCursorLogin={() => openLoginForProvider('cursor')}
                onCodexLogin={() => openLoginForProvider('codex')}
                onGeminiLogin={() => openLoginForProvider('gemini')}
                claudePermissions={claudePermissions}
                onClaudePermissionsChange={setClaudePermissions}
                cursorPermissions={cursorPermissions}
                onCursorPermissionsChange={setCursorPermissions}
                codexPermissionMode={codexPermissionMode}
                onCodexPermissionModeChange={setCodexPermissionMode}
                geminiPermissionMode={geminiPermissionMode}
                onGeminiPermissionModeChange={setGeminiPermissionMode}
                mcpServers={mcpServers}
                cursorMcpServers={cursorMcpServers}
                codexMcpServers={codexMcpServers}
                mcpTestResults={mcpTestResults}
                mcpServerTools={mcpServerTools}
                mcpToolsLoading={mcpToolsLoading}
                onOpenMcpForm={openMcpForm}
                onDeleteMcpServer={handleMcpDelete}
                onTestMcpServer={handleMcpTest}
                onDiscoverMcpTools={handleMcpToolsDiscovery}
                onOpenCodexMcpForm={openCodexMcpForm}
                onDeleteCodexMcpServer={handleCodexMcpDelete}
                deleteError={deleteError}
              />
            )}

            {activeTab === 'tasks' && (
              <div className="space-y-6 md:space-y-8">
                <TasksSettingsTab />
              </div>
            )}

            {activeTab === 'api' && (
              <div className="space-y-6 md:space-y-8">
                <CredentialsSettingsTab />
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-shrink-0 flex-col gap-3 border-t border-border p-4 pb-safe-area-inset-bottom sm:flex-row sm:items-center sm:justify-between md:p-6">
          <div className="order-2 flex items-center justify-center gap-2 sm:order-1 sm:justify-start">
            {saveStatus === 'success' && (
              <div className="flex items-center gap-1 text-sm text-green-600 dark:text-green-400">
                <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
                {t('saveStatus.success')}
              </div>
            )}
            {saveStatus === 'error' && (
              <div className="flex items-center gap-1 text-sm text-red-600 dark:text-red-400">
                <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                </svg>
                {t('saveStatus.error')}
              </div>
            )}
          </div>
          <div className="order-1 flex items-center gap-3 sm:order-2">
            <Button
              variant="outline"
              onClick={onClose}
              disabled={isSaving}
              className="h-10 flex-1 touch-manipulation sm:flex-none"
            >
              {t('footerActions.cancel')}
            </Button>
            <Button
              onClick={saveSettings}
              disabled={isSaving}
              className="h-10 flex-1 touch-manipulation bg-blue-600 hover:bg-blue-700 disabled:opacity-50 sm:flex-none"
            >
              {isSaving ? (
                <div className="flex items-center gap-2">
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  {t('saveStatus.saving')}
                </div>
              ) : (
                t('footerActions.save')
              )}
            </Button>
          </div>
        </div>
      </div>

      <ProviderLoginModal
        key={loginProvider || 'claude'}
        isOpen={showLoginModal}
        onClose={() => setShowLoginModal(false)}
        provider={loginProvider || 'claude'}
        project={selectedProject}
        onComplete={handleLoginComplete}
        isAuthenticated={isAuthenticated}
      />

      <ClaudeMcpFormModal
        isOpen={showMcpForm}
        editingServer={editingMcpServer}
        projects={projects}
        onClose={closeMcpForm}
        onSubmit={submitMcpForm}
      />

      <CodexMcpFormModal
        isOpen={showCodexMcpForm}
        editingServer={editingCodexMcpServer}
        onClose={closeCodexMcpForm}
        onSubmit={submitCodexMcpForm}
      />
    </div>
  );
}

export default Settings;
