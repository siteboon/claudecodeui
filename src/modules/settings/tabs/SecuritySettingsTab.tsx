import { Check, LogOut } from 'lucide-react';
import type { FormEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { useAuth } from '@/modules/auth';
import { useChangePassword } from '@/modules/settings/hooks/useChangePassword';
import SettingsCard from '@/modules/settings/SettingsCard';
import SettingsSection from '@/modules/settings/SettingsSection';
import { Button, Input } from '@/shared/ui';

/** Rendered by Settings for the "security" tab: change the login password and sign out. */
export default function SecuritySettingsTab() {
  const { t } = useTranslation('settings');
  const { user, logout } = useAuth();
  const {
    currentPassword,
    setCurrentPassword,
    newPassword,
    setNewPassword,
    confirmPassword,
    setConfirmPassword,
    isSaving,
    status,
    errorMessage,
    canSubmit,
    submit,
  } = useChangePassword();

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void submit();
  };

  return (
    <div className="space-y-8">
      <SettingsSection title={t('security.changePassword')} description={t('security.description')}>
        <SettingsCard className="p-4">
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Lets password managers associate the new password with the right account. */}
            <input
              type="text"
              name="username"
              autoComplete="username"
              value={user?.username ?? ''}
              readOnly
              hidden
            />

            <div>
              <label htmlFor="settings-current-password" className="mb-2 block text-sm font-medium text-foreground">
                {t('security.currentPassword')}
              </label>
              <Input
                id="settings-current-password"
                type="password"
                autoComplete="current-password"
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
                disabled={isSaving}
                className="w-full"
              />
            </div>

            <div>
              <label htmlFor="settings-new-password" className="mb-2 block text-sm font-medium text-foreground">
                {t('security.newPassword')}
              </label>
              <Input
                id="settings-new-password"
                type="password"
                autoComplete="new-password"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                disabled={isSaving}
                className="w-full"
              />
              <p className="mt-1 text-xs text-muted-foreground">{t('security.passwordHint')}</p>
            </div>

            <div>
              <label htmlFor="settings-confirm-password" className="mb-2 block text-sm font-medium text-foreground">
                {t('security.confirmPassword')}
              </label>
              <Input
                id="settings-confirm-password"
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                disabled={isSaving}
                className="w-full"
              />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button type="submit" disabled={!canSubmit}>
                {isSaving ? t('security.actions.saving') : t('security.actions.save')}
              </Button>

              {status === 'success' && (
                <div role="status" className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400">
                  <Check className="h-4 w-4" />
                  {t('security.status.success')}
                </div>
              )}
              {status === 'error' && errorMessage && (
                <div role="alert" className="text-sm text-red-600 dark:text-red-400">
                  {errorMessage}
                </div>
              )}
            </div>
          </form>
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title={t('security.signOutTitle')} description={t('security.signOutDescription')}>
        <SettingsCard className="p-4">
          <Button variant="outline" onClick={logout}>
            <LogOut className="mr-2 h-4 w-4" />
            {t('security.actions.signOut')}
          </Button>
        </SettingsCard>
      </SettingsSection>
    </div>
  );
}
