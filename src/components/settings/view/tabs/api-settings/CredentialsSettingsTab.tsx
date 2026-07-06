import { useTranslation } from 'react-i18next';
import { useCredentialsSettings } from '../../../hooks/useCredentialsSettings';
import ApiKeysSection from './sections/ApiKeysSection';
import GitlabCredentialsSection from './sections/GitlabCredentialsSection';
import GithubCredentialsSection from './sections/GithubCredentialsSection';
import NewApiKeyAlert from './sections/NewApiKeyAlert';

export default function CredentialsSettingsTab() {
  const { t } = useTranslation('settings');
  const {
    apiKeys,
    githubCredentials,
    gitlabCredentials,
    loading,
    showNewKeyForm,
    setShowNewKeyForm,
    newKeyName,
    setNewKeyName,
    showNewGithubForm,
    setShowNewGithubForm,
    newGithubName,
    setNewGithubName,
    newGithubToken,
    setNewGithubToken,
    newGithubDescription,
    setNewGithubDescription,
    showNewGitlabForm,
    setShowNewGitlabForm,
    newGitlabName,
    setNewGitlabName,
    newGitlabHost,
    setNewGitlabHost,
    newGitlabToken,
    setNewGitlabToken,
    newGitlabDescription,
    setNewGitlabDescription,
    showToken,
    copiedKey,
    newlyCreatedKey,
    createApiKey,
    deleteApiKey,
    toggleApiKey,
    createGithubCredential,
    createGitlabCredential,
    deleteGithubCredential,
    deleteGitlabCredential,
    toggleGithubCredential,
    toggleGitlabCredential,
    copyToClipboard,
    dismissNewlyCreatedKey,
    cancelNewApiKeyForm,
    cancelNewGithubForm,
    cancelNewGitlabForm,
    toggleNewGithubTokenVisibility,
    toggleNewGitlabTokenVisibility,
  } = useCredentialsSettings({
    confirmDeleteApiKeyText: t('apiKeys.confirmDelete'),
    confirmDeleteGithubCredentialText: t('apiKeys.github.confirmDelete'),
    confirmDeleteGitlabCredentialText: t('apiKeys.gitlab.confirmDelete'),
  });

  if (loading) {
    return <div className="text-muted-foreground">{t('apiKeys.loading')}</div>;
  }

  return (
    <div className="space-y-8">
      {newlyCreatedKey && (
        <NewApiKeyAlert
          apiKey={newlyCreatedKey}
          copiedKey={copiedKey}
          onCopy={copyToClipboard}
          onDismiss={dismissNewlyCreatedKey}
        />
      )}

      <ApiKeysSection
        apiKeys={apiKeys}
        showNewKeyForm={showNewKeyForm}
        newKeyName={newKeyName}
        onShowNewKeyFormChange={setShowNewKeyForm}
        onNewKeyNameChange={setNewKeyName}
        onCreateApiKey={createApiKey}
        onCancelCreateApiKey={cancelNewApiKeyForm}
        onToggleApiKey={toggleApiKey}
        onDeleteApiKey={deleteApiKey}
      />

      <GithubCredentialsSection
        githubCredentials={githubCredentials}
        showNewGithubForm={showNewGithubForm}
        showNewTokenPlainText={Boolean(showToken.new)}
        newGithubName={newGithubName}
        newGithubToken={newGithubToken}
        newGithubDescription={newGithubDescription}
        onShowNewGithubFormChange={setShowNewGithubForm}
        onNewGithubNameChange={setNewGithubName}
        onNewGithubTokenChange={setNewGithubToken}
        onNewGithubDescriptionChange={setNewGithubDescription}
        onToggleNewTokenVisibility={toggleNewGithubTokenVisibility}
        onCreateGithubCredential={createGithubCredential}
        onCancelCreateGithubCredential={cancelNewGithubForm}
        onToggleGithubCredential={toggleGithubCredential}
        onDeleteGithubCredential={deleteGithubCredential}
      />

      <GitlabCredentialsSection
        gitlabCredentials={gitlabCredentials}
        showNewGitlabForm={showNewGitlabForm}
        showNewTokenPlainText={Boolean(showToken.newGitlab)}
        newGitlabName={newGitlabName}
        newGitlabHost={newGitlabHost}
        newGitlabToken={newGitlabToken}
        newGitlabDescription={newGitlabDescription}
        onShowNewGitlabFormChange={setShowNewGitlabForm}
        onNewGitlabNameChange={setNewGitlabName}
        onNewGitlabHostChange={setNewGitlabHost}
        onNewGitlabTokenChange={setNewGitlabToken}
        onNewGitlabDescriptionChange={setNewGitlabDescription}
        onToggleNewTokenVisibility={toggleNewGitlabTokenVisibility}
        onCreateGitlabCredential={createGitlabCredential}
        onCancelCreateGitlabCredential={cancelNewGitlabForm}
        onToggleGitlabCredential={toggleGitlabCredential}
        onDeleteGitlabCredential={deleteGitlabCredential}
      />

    </div>
  );
}
