import { Eye, EyeOff, Key, Plus, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button, Input } from '../../../../../../shared/view/ui';
import type { GithubCredentialItem } from '../types';

type GitlabCredentialsSectionProps = {
  gitlabCredentials: GithubCredentialItem[];
  showNewGitlabForm: boolean;
  showNewTokenPlainText: boolean;
  newGitlabName: string;
  newGitlabHost: string;
  newGitlabToken: string;
  newGitlabDescription: string;
  onShowNewGitlabFormChange: (value: boolean) => void;
  onNewGitlabNameChange: (value: string) => void;
  onNewGitlabHostChange: (value: string) => void;
  onNewGitlabTokenChange: (value: string) => void;
  onNewGitlabDescriptionChange: (value: string) => void;
  onToggleNewTokenVisibility: () => void;
  onCreateGitlabCredential: () => void;
  onCancelCreateGitlabCredential: () => void;
  onToggleGitlabCredential: (credentialId: string, isActive: boolean) => void;
  onDeleteGitlabCredential: (credentialId: string) => void;
};

export default function GitlabCredentialsSection({
  gitlabCredentials,
  showNewGitlabForm,
  showNewTokenPlainText,
  newGitlabName,
  newGitlabHost,
  newGitlabToken,
  newGitlabDescription,
  onShowNewGitlabFormChange,
  onNewGitlabNameChange,
  onNewGitlabHostChange,
  onNewGitlabTokenChange,
  onNewGitlabDescriptionChange,
  onToggleNewTokenVisibility,
  onCreateGitlabCredential,
  onCancelCreateGitlabCredential,
  onToggleGitlabCredential,
  onDeleteGitlabCredential,
}: GitlabCredentialsSectionProps) {
  const { t } = useTranslation('settings');

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Key className="h-5 w-5" />
          <h3 className="text-lg font-semibold">{t('apiKeys.gitlab.title')}</h3>
        </div>
        <Button size="sm" onClick={() => onShowNewGitlabFormChange(!showNewGitlabForm)}>
          <Plus className="mr-1 h-4 w-4" />
          {t('apiKeys.gitlab.addButton')}
        </Button>
      </div>

      <p className="mb-4 text-sm text-muted-foreground">{t('apiKeys.gitlab.description')}</p>

      {showNewGitlabForm && (
        <div className="mb-4 space-y-3 rounded-lg border bg-card p-4">
          <Input
            placeholder={t('apiKeys.gitlab.form.namePlaceholder')}
            value={newGitlabName}
            onChange={(event) => onNewGitlabNameChange(event.target.value)}
          />
          <Input
            placeholder={t('apiKeys.gitlab.form.hostPlaceholder')}
            value={newGitlabHost}
            onChange={(event) => onNewGitlabHostChange(event.target.value)}
          />

          <div className="relative">
            <Input
              type={showNewTokenPlainText ? 'text' : 'password'}
              placeholder={t('apiKeys.gitlab.form.tokenPlaceholder')}
              value={newGitlabToken}
              onChange={(event) => onNewGitlabTokenChange(event.target.value)}
              className="pr-10"
            />
            <button
              type="button"
              onClick={onToggleNewTokenVisibility}
              aria-label={showNewTokenPlainText ? 'Hide token' : 'Show token'}
              className="absolute right-3 top-2.5 text-muted-foreground hover:text-foreground"
            >
              {showNewTokenPlainText ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>

          <Input
            placeholder={t('apiKeys.gitlab.form.descriptionPlaceholder')}
            value={newGitlabDescription}
            onChange={(event) => onNewGitlabDescriptionChange(event.target.value)}
          />

          <div className="flex gap-2">
            <Button onClick={onCreateGitlabCredential}>{t('apiKeys.gitlab.form.addButton')}</Button>
            <Button variant="outline" onClick={onCancelCreateGitlabCredential}>
              {t('apiKeys.gitlab.form.cancelButton')}
            </Button>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {gitlabCredentials.length === 0 ? (
          <p className="text-sm italic text-muted-foreground">{t('apiKeys.gitlab.empty')}</p>
        ) : (
          gitlabCredentials.map((credential) => (
            <div key={credential.id} className="flex items-center justify-between rounded-lg border p-3">
              <div className="flex-1">
                <div className="font-medium">{credential.credential_name}</div>
                {credential.credential_host && (
                  <div className="text-xs text-muted-foreground">{credential.credential_host}</div>
                )}
                {credential.description && (
                  <div className="text-xs text-muted-foreground">{credential.description}</div>
                )}
                <div className="mt-1 text-xs text-muted-foreground">
                  {t('apiKeys.gitlab.added')} {new Date(credential.created_at).toLocaleDateString()}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant={credential.is_active ? 'outline' : 'secondary'}
                  onClick={() => onToggleGitlabCredential(credential.id, credential.is_active)}
                >
                  {credential.is_active ? t('apiKeys.status.active') : t('apiKeys.status.inactive')}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => onDeleteGitlabCredential(credential.id)}>
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
