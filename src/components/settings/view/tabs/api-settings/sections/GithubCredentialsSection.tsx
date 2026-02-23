import { Eye, EyeOff, Github, Plus, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../../../../ui/button';
import { Input } from '../../../../../ui/input';
import type { GithubCredentialItem } from '../types';

type GithubCredentialsSectionProps = {
  githubCredentials: GithubCredentialItem[];
  showNewGithubForm: boolean;
  showNewTokenPlainText: boolean;
  newGithubName: string;
  newGithubToken: string;
  newGithubDescription: string;
  onShowNewGithubFormChange: (value: boolean) => void;
  onNewGithubNameChange: (value: string) => void;
  onNewGithubTokenChange: (value: string) => void;
  onNewGithubDescriptionChange: (value: string) => void;
  onToggleNewTokenVisibility: () => void;
  onCreateGithubCredential: () => void;
  onCancelCreateGithubCredential: () => void;
  onToggleGithubCredential: (credentialId: string, isActive: boolean) => void;
  onDeleteGithubCredential: (credentialId: string) => void;
};

export default function GithubCredentialsSection({
  githubCredentials,
  showNewGithubForm,
  showNewTokenPlainText,
  newGithubName,
  newGithubToken,
  newGithubDescription,
  onShowNewGithubFormChange,
  onNewGithubNameChange,
  onNewGithubTokenChange,
  onNewGithubDescriptionChange,
  onToggleNewTokenVisibility,
  onCreateGithubCredential,
  onCancelCreateGithubCredential,
  onToggleGithubCredential,
  onDeleteGithubCredential,
}: GithubCredentialsSectionProps) {
  const { t } = useTranslation('settings');

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Github className="h-5 w-5" />
          <h3 className="text-lg font-semibold">{t('apiKeys.github.title')}</h3>
        </div>
        <Button size="sm" onClick={() => onShowNewGithubFormChange(!showNewGithubForm)}>
          <Plus className="h-4 w-4 mr-1" />
          {t('apiKeys.github.addButton')}
        </Button>
      </div>

      <p className="text-sm text-muted-foreground mb-4">{t('apiKeys.github.descriptionAlt')}</p>

      {showNewGithubForm && (
        <div className="mb-4 p-4 border rounded-lg bg-card space-y-3">
          <Input
            placeholder={t('apiKeys.github.form.namePlaceholder')}
            value={newGithubName}
            onChange={(event) => onNewGithubNameChange(event.target.value)}
          />

          <div className="relative">
            <Input
              type={showNewTokenPlainText ? 'text' : 'password'}
              placeholder={t('apiKeys.github.form.tokenPlaceholder')}
              value={newGithubToken}
              onChange={(event) => onNewGithubTokenChange(event.target.value)}
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
            placeholder={t('apiKeys.github.form.descriptionPlaceholder')}
            value={newGithubDescription}
            onChange={(event) => onNewGithubDescriptionChange(event.target.value)}
          />

          <div className="flex gap-2">
            <Button onClick={onCreateGithubCredential}>{t('apiKeys.github.form.addButton')}</Button>
            <Button variant="outline" onClick={onCancelCreateGithubCredential}>
              {t('apiKeys.github.form.cancelButton')}
            </Button>
          </div>

          <a
            href="https://github.com/settings/tokens"
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-primary hover:underline block"
          >
            {t('apiKeys.github.form.howToCreate')}
          </a>
        </div>
      )}

      <div className="space-y-2">
        {githubCredentials.length === 0 ? (
          <p className="text-sm text-muted-foreground italic">{t('apiKeys.github.empty')}</p>
        ) : (
          githubCredentials.map((credential) => (
            <div key={credential.id} className="flex items-center justify-between p-3 border rounded-lg">
              <div className="flex-1">
                <div className="font-medium">{credential.credential_name}</div>
                {credential.description && (
                  <div className="text-xs text-muted-foreground">{credential.description}</div>
                )}
                <div className="text-xs text-muted-foreground mt-1">
                  {t('apiKeys.github.added')} {new Date(credential.created_at).toLocaleDateString()}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant={credential.is_active ? 'outline' : 'secondary'}
                  onClick={() => onToggleGithubCredential(credential.id, credential.is_active)}
                >
                  {credential.is_active ? t('apiKeys.status.active') : t('apiKeys.status.inactive')}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => onDeleteGithubCredential(credential.id)}>
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
