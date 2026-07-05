import { AlertCircle, Check, Loader2 } from 'lucide-react';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button, Input } from '../../../../../shared/view/ui';
import { api } from '../../../../../utils/api';
import SettingsCard from '../../SettingsCard';
import SettingsSection from '../../SettingsSection';

type Status = 'idle' | 'saving' | 'success' | 'error';

type ChangePasswordResponse = {
  success?: boolean;
  error?: string;
};

export default function PasswordSettingsTab() {
  const { t } = useTranslation('settings');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [errorMessage, setErrorMessage] = useState('');

  const handleChangePassword = useCallback(async () => {
    if (status === 'saving') return;

    setErrorMessage('');

    if (!currentPassword || !newPassword || !confirmPassword) {
      setStatus('error');
      setErrorMessage(t('password.error.fillAllFields', 'Fill out all password fields.'));
      return;
    }

    if (newPassword.length < 6) {
      setStatus('error');
      setErrorMessage(t('password.error.minLength', 'New password must be at least 6 characters.'));
      return;
    }

    if (newPassword !== confirmPassword) {
      setStatus('error');
      setErrorMessage(t('password.error.notMatch', 'New passwords do not match.'));
      return;
    }

    if (currentPassword === newPassword) {
      setStatus('error');
      setErrorMessage(t('password.error.sameAsCurrent', 'New password must be different from the current password.'));
      return;
    }

    setStatus('saving');

    try {
      const response = await api.auth.changePassword(currentPassword, newPassword);
      const result = await response.json().catch(() => ({} as ChangePasswordResponse));

      if (!response.ok || !result.success) {
        setStatus('error');
        setErrorMessage(result.error || t('password.error.failed', 'Failed to change password.'));
        return;
      }

      setStatus('success');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (error) {
      setStatus('error');
      setErrorMessage(error instanceof Error ? error.message : t('password.error.failed', 'Failed to change password.'));
    }
  }, [confirmPassword, currentPassword, newPassword, status, t]);

  const canSave = Boolean(currentPassword && newPassword && confirmPassword && status !== 'saving');

  return (
    <SettingsSection
      title={t('password.title', 'Password')}
      description={t('password.description', 'Change the password for the current CloudCLI account.')}
    >
      <SettingsCard className="p-4">
        <div className="space-y-4">
          <div>
            <label htmlFor="settings-current-password" className="mb-2 block text-sm font-medium text-foreground">
              {t('password.currentPassword', 'Current password')}
            </label>
            <Input
              id="settings-current-password"
              type="password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
              disabled={status === 'saving'}
              autoComplete="current-password"
            />
          </div>

          <div>
            <label htmlFor="settings-new-password" className="mb-2 block text-sm font-medium text-foreground">
              {t('password.newPassword', 'New password')}
            </label>
            <Input
              id="settings-new-password"
              type="password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              disabled={status === 'saving'}
              autoComplete="new-password"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              {t('password.minLengthHelp', 'Use at least {{min}} characters.', { min: 6 })}
            </p>
          </div>

          <div>
            <label htmlFor="settings-confirm-password" className="mb-2 block text-sm font-medium text-foreground">
              {t('password.confirmPassword', 'Confirm new password')}
            </label>
            <Input
              id="settings-confirm-password"
              type="password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              disabled={status === 'saving'}
              autoComplete="new-password"
            />
          </div>

          {status === 'error' && errorMessage && (
            <div className="flex items-start gap-2 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={handleChangePassword} disabled={!canSave}>
              {status === 'saving' ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {t('password.saving', 'Saving...')}
                </>
              ) : (
                t('password.saveChanges', 'Change password')
              )}
            </Button>

            {status === 'success' && (
              <span className="inline-flex items-center gap-2 text-sm text-green-600 dark:text-green-400">
                <Check className="h-4 w-4" />
                {t('password.success', 'Password changed.')}
              </span>
            )}
          </div>
        </div>
      </SettingsCard>
    </SettingsSection>
  );
}
