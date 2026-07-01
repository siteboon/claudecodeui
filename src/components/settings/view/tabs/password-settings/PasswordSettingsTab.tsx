import { AlertCircle, Check, Loader2 } from 'lucide-react';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../../../../utils/api';
import { Button, Input } from '../../../../../shared/view/ui';
import SettingsCard from '../../SettingsCard';
import SettingsSection from '../../SettingsSection';

type Status = 'idle' | 'saving' | 'success' | 'error';

export default function PasswordSettingsTab() {
  const { t } = useTranslation('settings');

  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [errorMessage, setErrorMessage] = useState('');

  const handleChangePassword = useCallback(async () => {
    setErrorMessage('');

    // Prevent duplicate requests while one is in flight
    if (status === 'saving') return;

    if (!oldPassword || !newPassword || !confirmPassword) {
      setStatus('error');
      setErrorMessage(t('password.error.fillAllFields'));
      return;
    }

    if (newPassword.length < 6) {
      setStatus('error');
      setErrorMessage(t('password.error.minLength'));
      return;
    }

    if (newPassword !== confirmPassword) {
      setStatus('error');
      setErrorMessage(t('password.error.notMatch'));
      return;
    }

    if (oldPassword === newPassword) {
      setStatus('error');
      setErrorMessage(t('password.error.sameAsOld'));
      return;
    }

    setStatus('saving');

    try {
      const result = await api.auth.changePassword(oldPassword, newPassword);
      if (result.success) {
        setStatus('success');
        setOldPassword('');
        setNewPassword('');
        setConfirmPassword('');
      } else {
        setStatus('error');
        setErrorMessage(result.error || t('password.error.failed'));
      }
    } catch (err: any) {
      setStatus('error');
      const msg = err.response?.data?.error || err.message || t('password.error.failed');
      if (msg === 'Current password is incorrect') {
        setErrorMessage(t('password.error.incorrectOld'));
      } else {
        setErrorMessage(msg);
      }
    }
  }, [oldPassword, newPassword, confirmPassword, t]);

  const canSave = oldPassword && newPassword && confirmPassword && status !== 'saving';

  return (
    <div className="space-y-8">
      <SettingsSection
        title={t('password.title')}
        description={t('password.description')}
      >
        <SettingsCard className="p-4">
          <div className="space-y-4">
            {/* Current password */}
            <div>
              <label
                htmlFor="settings-password-old"
                className="mb-2 block text-sm font-medium text-foreground"
              >
                {t('password.currentPassword')}
              </label>
              <Input
                id="settings-password-old"
                type="password"
                value={oldPassword}
                onChange={(e) => setOldPassword(e.target.value)}
                placeholder={t('password.currentPasswordPlaceholder')}
                disabled={status === 'saving'}
                className="w-full"
              />
            </div>

            {/* New password */}
            <div>
              <label
                htmlFor="settings-password-new"
                className="mb-2 block text-sm font-medium text-foreground"
              >
                {t('password.newPassword')}
              </label>
              <Input
                id="settings-password-new"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder={t('password.newPasswordPlaceholder')}
                disabled={status === 'saving'}
                className="w-full"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                {t('password.minLengthHelp', { min: 6 })}
              </p>
            </div>

            {/* Confirm new password */}
            <div>
              <label
                htmlFor="settings-password-confirm"
                className="mb-2 block text-sm font-medium text-foreground"
              >
                {t('password.confirmPassword')}
              </label>
              <Input
                id="settings-password-confirm"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder={t('password.confirmPasswordPlaceholder')}
                disabled={status === 'saving'}
                className="w-full"
              />
            </div>

            {/* Error message */}
            {status === 'error' && errorMessage && (
              <div className="flex items-start gap-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-950 dark:text-red-400">
                <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                <span>{errorMessage}</span>
              </div>
            )}

            {/* Actions */}
            <div className="flex items-center gap-2">
              <Button onClick={handleChangePassword} disabled={!canSave}>
                {status === 'saving' ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    {t('password.saving')}
                  </>
                ) : (
                  t('password.saveChanges')
                )}
              </Button>

              {status === 'success' && (
                <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400">
                  <Check className="h-4 w-4" />
                  {t('password.success')}
                </div>
              )}
            </div>
          </div>
        </SettingsCard>
      </SettingsSection>
    </div>
  );
}
