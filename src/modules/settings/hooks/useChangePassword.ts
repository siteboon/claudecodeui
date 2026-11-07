import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { api, readApiErrorMessage } from '@/shared/api';

// Mirrors the server's minimum so the user sees the problem before submitting.
const MIN_PASSWORD_LENGTH = 6;

type ChangePasswordStatus = 'success' | 'error' | null;

/** Used by SecuritySettingsTab to hold the change-password form and submit it. */
export function useChangePassword() {
  const { t } = useTranslation('settings');
  // The three form fields; cleared after a successful change.
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  // Disables the form while the request is in flight.
  const [isSaving, setIsSaving] = useState(false);
  // Drives the inline success/error feedback next to the button.
  const [status, setStatus] = useState<ChangePasswordStatus>(null);
  // Localized message shown when status is 'error'.
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const clearStatusTimerRef = useRef<number | null>(null);

  const fail = useCallback((message: string) => {
    setStatus('error');
    setErrorMessage(message);
  }, []);

  const submit = useCallback(async () => {
    if (newPassword !== confirmPassword) {
      fail(t('security.errors.mismatch'));
      return;
    }
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      fail(t('security.errors.tooShort'));
      return;
    }

    setIsSaving(true);
    setStatus(null);
    setErrorMessage(null);
    try {
      const response = await api.auth.changePassword(currentPassword, newPassword);
      if (response.ok) {
        setCurrentPassword('');
        setNewPassword('');
        setConfirmPassword('');
        setStatus('success');
        clearStatusTimerRef.current = window.setTimeout(() => {
          setStatus(null);
          clearStatusTimerRef.current = null;
        }, 3000);
        return;
      }

      const body: unknown = await response.json().catch(() => null);
      const code = (body as { error?: { code?: unknown } } | null)?.error?.code;
      if (code === 'AUTH_INVALID_CURRENT_PASSWORD') {
        fail(t('security.errors.incorrectCurrent'));
      } else if (code === 'AUTH_CREDENTIALS_TOO_SHORT') {
        fail(t('security.errors.tooShort'));
      } else {
        fail(readApiErrorMessage(body) ?? t('security.errors.generic'));
      }
    } catch (error) {
      console.error('Error changing password:', error);
      fail(t('security.errors.generic'));
    } finally {
      setIsSaving(false);
    }
  }, [confirmPassword, currentPassword, fail, newPassword, t]);

  useEffect(() => () => {
    if (clearStatusTimerRef.current !== null) {
      window.clearTimeout(clearStatusTimerRef.current);
    }
  }, []);

  return {
    currentPassword,
    setCurrentPassword,
    newPassword,
    setNewPassword,
    confirmPassword,
    setConfirmPassword,
    isSaving,
    status,
    errorMessage,
    canSubmit: Boolean(currentPassword && newPassword && confirmPassword) && !isSaving,
    submit,
  };
}
