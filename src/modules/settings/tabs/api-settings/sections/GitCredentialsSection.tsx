import { Eye, EyeOff, Github, Key, Plus, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button, Input } from '@/shared/ui';
import type { GitCredentialItem } from '@/shared/types';

type GitCredentialsSectionProvider = 'github' | 'gitlab' | 'bitbucket';

type GitCredentialsSectionProps = {
  provider: GitCredentialsSectionProvider;
  credentials: GitCredentialItem[];
  loadError: string | null;
  showNewForm: boolean;
  showTokenPlainText: boolean;
  newName: string;
  newToken: string;
  newDescription: string;
  onShowNewFormChange: (value: boolean) => void;
  onNewNameChange: (value: string) => void;
  onNewTokenChange: (value: string) => void;
  onNewDescriptionChange: (value: string) => void;
  onToggleNewTokenVisibility: () => void;
  onCreateCredential: () => void;
  onCancelCreateCredential: () => void;
  onToggleCredential: (credentialId: string, isActive: boolean) => void;
  onDeleteCredential: (credentialId: string) => void;
};

/** lucide-react doesn't ship GitLab/Bitbucket brand icons, so both fall back to a generic key icon rather than guessing at a nonexistent import. */
const PROVIDER_ICON = {
  github: Github,
  gitlab: Key,
  bitbucket: Key,
} as const;

/** Token-creation page per provider. Bitbucket Cloud retired app passwords in favor of Atlassian account API tokens. */
const HOW_TO_CREATE_URL: Record<GitCredentialsSectionProvider, string> = {
  github: 'https://github.com/settings/tokens',
  gitlab: 'https://gitlab.com/-/user_settings/personal_access_tokens',
  bitbucket: 'https://id.atlassian.com/manage-profile/security/api-tokens',
};

/** Rendered by CredentialsSettingsTab (once per provider) to list, create and delete stored git credentials. */
export default function GitCredentialsSection({
  provider,
  credentials,
  loadError,
  showNewForm,
  showTokenPlainText,
  newName,
  newToken,
  newDescription,
  onShowNewFormChange,
  onNewNameChange,
  onNewTokenChange,
  onNewDescriptionChange,
  onToggleNewTokenVisibility,
  onCreateCredential,
  onCancelCreateCredential,
  onToggleCredential,
  onDeleteCredential,
}: GitCredentialsSectionProps) {
  const { t } = useTranslation('settings');
  const Icon = PROVIDER_ICON[provider];

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon className="h-5 w-5" />
          <h3 className="text-lg font-semibold">{t(`apiKeys.${provider}.title`)}</h3>
        </div>
        <Button size="sm" onClick={() => onShowNewFormChange(!showNewForm)}>
          <Plus className="mr-1 h-4 w-4" />
          {t(`apiKeys.${provider}.addButton`)}
        </Button>
      </div>

      <p className="mb-4 text-sm text-muted-foreground">{t(`apiKeys.${provider}.descriptionAlt`)}</p>

      {showNewForm && (
        <div className="mb-4 space-y-3 rounded-lg border bg-card p-4">
          <Input
            placeholder={t(`apiKeys.${provider}.form.namePlaceholder`)}
            value={newName}
            onChange={(event) => onNewNameChange(event.target.value)}
          />

          <div className="relative">
            <Input
              type={showTokenPlainText ? 'text' : 'password'}
              placeholder={t(`apiKeys.${provider}.form.tokenPlaceholder`)}
              value={newToken}
              onChange={(event) => onNewTokenChange(event.target.value)}
              className="pr-10"
            />
            <button
              type="button"
              onClick={onToggleNewTokenVisibility}
              aria-label={showTokenPlainText ? 'Hide token' : 'Show token'}
              className="absolute right-3 top-2.5 text-muted-foreground hover:text-foreground"
            >
              {showTokenPlainText ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>

          <Input
            placeholder={t(`apiKeys.${provider}.form.descriptionPlaceholder`)}
            value={newDescription}
            onChange={(event) => onNewDescriptionChange(event.target.value)}
          />

          <div className="flex gap-2">
            <Button onClick={onCreateCredential}>{t(`apiKeys.${provider}.form.addButton`)}</Button>
            <Button variant="outline" onClick={onCancelCreateCredential}>
              {t(`apiKeys.${provider}.form.cancelButton`)}
            </Button>
          </div>

          <a
            href={HOW_TO_CREATE_URL[provider]}
            target="_blank"
            rel="noopener noreferrer"
            className="block text-xs text-primary hover:underline"
          >
            {t(`apiKeys.${provider}.form.howToCreate`)}
          </a>
        </div>
      )}

      {loadError && (
        <p className="mb-3 text-sm text-red-600 dark:text-red-400">{loadError}</p>
      )}

      <div className="space-y-2">
        {!loadError && credentials.length === 0 ? (
          <p className="text-sm italic text-muted-foreground">{t(`apiKeys.${provider}.empty`)}</p>
        ) : (
          credentials.map((credential) => (
            <div key={credential.id} className="flex items-center justify-between rounded-lg border p-3">
              <div className="flex-1">
                <div className="font-medium">{credential.credential_name}</div>
                {credential.description && (
                  <div className="text-xs text-muted-foreground">{credential.description}</div>
                )}
                <div className="mt-1 text-xs text-muted-foreground">
                  {t(`apiKeys.${provider}.added`)} {new Date(credential.created_at).toLocaleDateString()}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant={credential.is_active ? 'outline' : 'secondary'}
                  onClick={() => onToggleCredential(credential.id, credential.is_active)}
                >
                  {credential.is_active ? t('apiKeys.status.active') : t('apiKeys.status.inactive')}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => onDeleteCredential(credential.id)}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
