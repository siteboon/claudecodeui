import { useTranslation } from 'react-i18next';

import { useCredentialsSettings } from '@/modules/settings/hooks/useCredentialsSettings';
import { useGitCredentialsSection } from '@/modules/settings/hooks/useGitCredentialsSection';
import ApiKeysSection from '@/modules/settings/tabs/api-settings/sections/ApiKeysSection';
import GitCredentialsSection from '@/modules/settings/tabs/api-settings/sections/GitCredentialsSection';
import NewApiKeyAlert from '@/modules/settings/tabs/api-settings/sections/NewApiKeyAlert';

const GIT_PROVIDERS = ['github', 'gitlab', 'bitbucket'] as const;

/** Rendered by Settings for the "api" tab, managing CloudCLI API keys and per-provider git credentials. */
export default function CredentialsSettingsTab() {
  const { t } = useTranslation('settings');
  const {
    apiKeys,
    loading,
    showNewKeyForm,
    setShowNewKeyForm,
    newKeyName,
    setNewKeyName,
    copiedKey,
    newlyCreatedKey,
    createApiKey,
    deleteApiKey,
    toggleApiKey,
    copyToClipboard,
    dismissNewlyCreatedKey,
    cancelNewApiKeyForm,
  } = useCredentialsSettings({
    confirmDeleteApiKeyText: t('apiKeys.confirmDelete'),
  });

  // Fixed-size array of hooks (one per provider in GIT_PROVIDERS), same pattern as calling
  // useCredentialsSettings once for API keys — not a variable-length list, so this doesn't
  // violate the rules of hooks.
  const github = useGitCredentialsSection({ provider: 'github', confirmDeleteText: t('apiKeys.github.confirmDelete') });
  const gitlab = useGitCredentialsSection({ provider: 'gitlab', confirmDeleteText: t('apiKeys.gitlab.confirmDelete') });
  const bitbucket = useGitCredentialsSection({ provider: 'bitbucket', confirmDeleteText: t('apiKeys.bitbucket.confirmDelete') });
  const gitSections = { github, gitlab, bitbucket };

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

      {GIT_PROVIDERS.map((provider) => {
        const section = gitSections[provider];
        return (
          <GitCredentialsSection
            key={provider}
            provider={provider}
            credentials={section.credentials}
            loadError={section.loadError}
            showNewForm={section.showNewForm}
            showTokenPlainText={section.showTokenPlainText}
            newName={section.newName}
            newToken={section.newToken}
            newDescription={section.newDescription}
            onShowNewFormChange={section.setShowNewForm}
            onNewNameChange={section.setNewName}
            onNewTokenChange={section.setNewToken}
            onNewDescriptionChange={section.setNewDescription}
            onToggleNewTokenVisibility={section.toggleNewTokenVisibility}
            onCreateCredential={section.createCredential}
            onCancelCreateCredential={section.cancelNewForm}
            onToggleCredential={section.toggleCredential}
            onDeleteCredential={section.deleteCredential}
          />
        );
      })}
    </div>
  );
}
