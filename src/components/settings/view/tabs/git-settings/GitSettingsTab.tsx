import { Check, GitBranch } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useGitSettings } from '../../../hooks/useGitSettings';
import { Button } from '../../../../ui/button';
import { Input } from '../../../../ui/input';

export default function GitSettingsTab() {
  const { t } = useTranslation('settings');
  const {
    gitName,
    setGitName,
    gitEmail,
    setGitEmail,
    isLoading,
    isSaving,
    saveStatus,
    saveGitConfig,
  } = useGitSettings();

  return (
    <div className="space-y-8">
      <div>
        <div className="flex items-center gap-2 mb-4">
          <GitBranch className="h-5 w-5" />
          <h3 className="text-lg font-semibold">{t('git.title')}</h3>
        </div>

        <p className="text-sm text-muted-foreground mb-4">{t('git.description')}</p>

        <div className="p-4 border rounded-lg bg-card space-y-3">
          <div>
            <label htmlFor="settings-git-name" className="block text-sm font-medium text-foreground mb-2">
              {t('git.name.label')}
            </label>
            <Input
              id="settings-git-name"
              type="text"
              value={gitName}
              onChange={(event) => setGitName(event.target.value)}
              placeholder="John Doe"
              disabled={isLoading}
              className="w-full"
            />
            <p className="mt-1 text-xs text-muted-foreground">{t('git.name.help')}</p>
          </div>

          <div>
            <label htmlFor="settings-git-email" className="block text-sm font-medium text-foreground mb-2">
              {t('git.email.label')}
            </label>
            <Input
              id="settings-git-email"
              type="email"
              value={gitEmail}
              onChange={(event) => setGitEmail(event.target.value)}
              placeholder="john@example.com"
              disabled={isLoading}
              className="w-full"
            />
            <p className="mt-1 text-xs text-muted-foreground">{t('git.email.help')}</p>
          </div>

          <div className="flex items-center gap-2">
            <Button
              onClick={saveGitConfig}
              disabled={isSaving || !gitName.trim() || !gitEmail.trim()}
            >
              {isSaving ? t('git.actions.saving') : t('git.actions.save')}
            </Button>

            {saveStatus === 'success' && (
              <div className="text-sm text-green-600 dark:text-green-400 flex items-center gap-2">
                <Check className="w-4 h-4" />
                {t('git.status.success')}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
