import { Settings as SettingsIcon, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import CredentialsSettings from '../CredentialsSettings';
import GitSettings from '../GitSettings';
import LoginModal from '../LoginModal';
import TasksSettings from '../TasksSettings';
import { Button } from '../ui/button';
import ClaudeMcpFormModal from './view/modals/ClaudeMcpFormModal';
import CodexMcpFormModal from './view/modals/CodexMcpFormModal';
import SettingsMainTabs from './view/SettingsMainTabs';
import AgentsSettingsTab from './view/tabs/agents-settings/AgentsSettingsTab';
import AppearanceSettingsTab from './view/tabs/AppearanceSettingsTab';
import { useSettingsController } from './hooks/useSettingsController';
import type { AgentProvider, SettingsProject, SettingsProps } from './types/types';

type LoginModalProps = {
  isOpen: boolean;
  onClose: () => void;
  provider: AgentProvider | '';
  project: SettingsProject | null;
  onComplete: (exitCode: number) => void;
  isAuthenticated: boolean;
};

const LoginModalComponent = LoginModal as unknown as (props: LoginModalProps) => JSX.Element;

function Settings({ isOpen, onClose, projects = [], initialTab = 'agents' }: SettingsProps) {
  const { t } = useTranslation('settings');
  const {
    activeTab,
    setActiveTab,
    isDarkMode,
    toggleDarkMode,
    isSaving,
    saveStatus,
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
    <div className="modal-backdrop fixed inset-0 flex items-center justify-center z-[9999] md:p-4 bg-background/95">
      <div className="bg-background border border-border md:rounded-lg shadow-xl w-full md:max-w-4xl h-full md:h-[90vh] flex flex-col">
        <div className="flex items-center justify-between p-4 md:p-6 border-b border-border flex-shrink-0">
          <div className="flex items-center gap-3">
            <SettingsIcon className="w-5 h-5 md:w-6 md:h-6 text-blue-600" />
            <h2 className="text-lg md:text-xl font-semibold text-foreground">{t('title')}</h2>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground touch-manipulation"
          >
            <X className="w-5 h-5" />
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto">
          <SettingsMainTabs activeTab={activeTab} onChange={setActiveTab} />

          <div className="p-4 md:p-6 space-y-6 md:space-y-8 pb-safe-area-inset-bottom">
            {activeTab === 'appearance' && (
              <AppearanceSettingsTab
                isDarkMode={isDarkMode}
                onToggleDarkMode={toggleDarkMode}
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

            {activeTab === 'git' && <GitSettings />}

            {activeTab === 'agents' && (
              <AgentsSettingsTab
                claudeAuthStatus={claudeAuthStatus}
                cursorAuthStatus={cursorAuthStatus}
                codexAuthStatus={codexAuthStatus}
                onClaudeLogin={() => openLoginForProvider('claude')}
                onCursorLogin={() => openLoginForProvider('cursor')}
                onCodexLogin={() => openLoginForProvider('codex')}
                claudePermissions={claudePermissions}
                onClaudePermissionsChange={setClaudePermissions}
                cursorPermissions={cursorPermissions}
                onCursorPermissionsChange={setCursorPermissions}
                codexPermissionMode={codexPermissionMode}
                onCodexPermissionModeChange={setCodexPermissionMode}
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
              />
            )}

            {activeTab === 'tasks' && (
              <div className="space-y-6 md:space-y-8">
                <TasksSettings />
              </div>
            )}

            {activeTab === 'api' && (
              <div className="space-y-6 md:space-y-8">
                <CredentialsSettings />
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between p-4 md:p-6 border-t border-border flex-shrink-0 gap-3 pb-safe-area-inset-bottom">
          <div className="flex items-center justify-center sm:justify-start gap-2 order-2 sm:order-1">
            {saveStatus === 'success' && (
              <div className="text-green-600 dark:text-green-400 text-sm flex items-center gap-1">
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
                {t('saveStatus.success')}
              </div>
            )}
            {saveStatus === 'error' && (
              <div className="text-red-600 dark:text-red-400 text-sm flex items-center gap-1">
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                </svg>
                {t('saveStatus.error')}
              </div>
            )}
          </div>
          <div className="flex items-center gap-3 order-1 sm:order-2">
            <Button
              variant="outline"
              onClick={onClose}
              disabled={isSaving}
              className="flex-1 sm:flex-none h-10 touch-manipulation"
            >
              {t('footerActions.cancel')}
            </Button>
            <Button
              onClick={saveSettings}
              disabled={isSaving}
              className="flex-1 sm:flex-none h-10 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 touch-manipulation"
            >
              {isSaving ? (
                <div className="flex items-center gap-2">
                  <div className="w-4 h-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  {t('saveStatus.saving')}
                </div>
              ) : (
                t('footerActions.save')
              )}
            </Button>
          </div>
        </div>
      </div>

      <LoginModalComponent
        key={loginProvider}
        isOpen={showLoginModal}
        onClose={() => setShowLoginModal(false)}
        provider={loginProvider}
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
