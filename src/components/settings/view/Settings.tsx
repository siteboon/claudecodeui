import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import ProviderLoginModal from '../../provider-auth/view/ProviderLoginModal';
import { Button } from '../../../shared/view/ui';
import ClaudeMcpFormModal from '../view/modals/ClaudeMcpFormModal';
import CodexMcpFormModal from '../view/modals/CodexMcpFormModal';
import SettingsSidebar from '../view/SettingsSidebar';
import AgentsSettingsTab from '../view/tabs/agents-settings/AgentsSettingsTab';
import AppearanceSettingsTab from '../view/tabs/AppearanceSettingsTab';
import CredentialsSettingsTab from '../view/tabs/api-settings/CredentialsSettingsTab';
import GitSettingsTab from '../view/tabs/git-settings/GitSettingsTab';
import NotificationsSettingsTab from '../view/tabs/NotificationsSettingsTab';
import TasksSettingsTab from '../view/tabs/tasks-settings/TasksSettingsTab';
import PluginSettingsTab from '../../plugins/view/PluginSettingsTab';
import { useSettingsController } from '../hooks/useSettingsController';
import { useWebPush } from '../../../hooks/useWebPush';
import type { SettingsProps } from '../types/types';

function Settings({ isOpen, onClose, projects = [], initialTab = 'agents' }: SettingsProps) {
  const { t } = useTranslation('settings');
  const {
    activeTab,
    setActiveTab,
    saveStatus,
    deleteError,
    projectSortOrder,
    setProjectSortOrder,
    codeEditorSettings,
    updateCodeEditorSetting,
    claudePermissions,
    setClaudePermissions,
    notificationPreferences,
    setNotificationPreferences,
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
  } = useSettingsController({
    isOpen,
    initialTab,
    projects,
    onClose,
  });

  const {
    permission: pushPermission,
    isSubscribed: isPushSubscribed,
    isLoading: isPushLoading,
    subscribe: pushSubscribe,
    unsubscribe: pushUnsubscribe,
  } = useWebPush();

  const handleEnablePush = async () => {
    await pushSubscribe();
    // Server sets webPush: true in preferences on subscribe; sync local state
    setNotificationPreferences({
      ...notificationPreferences,
      channels: { ...notificationPreferences.channels, webPush: true },
    });
  };

  const handleDisablePush = async () => {
    await pushUnsubscribe();
    // Server sets webPush: false in preferences on unsubscribe; sync local state
    setNotificationPreferences({
      ...notificationPreferences,
      channels: { ...notificationPreferences.channels, webPush: false },
    });
  };

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
    <div className="modal-backdrop fixed inset-0 z-[9999] flex items-center justify-center bg-background/80 backdrop-blur-sm md:p-4">
      <div className="flex h-full w-full flex-col overflow-hidden border border-border bg-background shadow-2xl md:h-[90vh] md:max-w-4xl md:rounded-xl">
        {/* Header */}
        <div className="flex flex-shrink-0 items-center justify-between border-b border-border px-4 py-3 md:px-5">
          <h2 className="text-base font-semibold text-foreground">{t('title')}</h2>
          <div className="flex items-center gap-2">
            {saveStatus === 'success' && (
              <span className="text-xs text-muted-foreground animate-in fade-in">{t('saveStatus.success')}</span>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={onClose}
              className="h-10 w-10 touch-manipulation p-0 text-muted-foreground hover:text-foreground active:bg-accent/50"
            >
              <X className="h-5 w-5" />
            </Button>
          </div>
        </div>

        {/* Body: sidebar + content */}
        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          <SettingsSidebar activeTab={activeTab} onChange={setActiveTab} />

          {/* Content */}
          <main className="flex-1 overflow-y-auto">
            <div key={activeTab} className="settings-content-enter space-y-6 p-4 pb-safe-area-inset-bottom md:space-y-8 md:p-6">
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

              {activeTab === 'tasks' && <TasksSettingsTab />}

            {activeTab === 'notifications' && (
              <NotificationsSettingsTab
                notificationPreferences={notificationPreferences}
                onNotificationPreferencesChange={setNotificationPreferences}
                pushPermission={pushPermission}
                isPushSubscribed={isPushSubscribed}
                isPushLoading={isPushLoading}
                onEnablePush={handleEnablePush}
                onDisablePush={handleDisablePush}
              />
            )}

              {activeTab === 'api' && <CredentialsSettingsTab />}

              {activeTab === 'plugins' && <PluginSettingsTab />}
            </div>
          </main>
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
