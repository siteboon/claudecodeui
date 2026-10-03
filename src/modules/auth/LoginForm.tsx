import { useCallback, useState } from 'react';
import type { FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, Lock, Shield, User } from 'lucide-react';

import { useAuth } from '@/modules/auth/context/AuthContext';
import AuthErrorAlert from '@/modules/auth/AuthErrorAlert';
import AuthInputField from '@/modules/auth/AuthInputField';
import AuthScreenLayout from '@/modules/auth/AuthScreenLayout';

type LoginFormState = {
  username: string;
  password: string;
  totpCode: string;
};

const initialState: LoginFormState = {
  username: '',
  password: '',
  totpCode: '',
};

/**
 * Login form component.
 * Rendered by the auth module's ProtectedRoute when no user session exists.
 * Handles credential input with browser autofill support (`autocomplete`
 * attributes) and optional RFC 6238 TOTP 2FA verification when enabled in Settings.
 */
export default function LoginForm() {
  const { t } = useTranslation('auth');
  const { error: sessionError, login, totpEnabled } = useAuth();

  const [formState, setFormState] = useState<LoginFormState>(initialState);
  const [errorMessage, setErrorMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [totpPrompted, setTotpPrompted] = useState(false);

  const showTotpInput = totpEnabled || totpPrompted;

  const updateField = useCallback((field: keyof LoginFormState, value: string) => {
    setFormState((previous) => ({ ...previous, [field]: value }));
  }, []);

  const handleSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setErrorMessage('');

      // Keep form validation local so each auth screen owns its own UI feedback.
      if (!formState.username.trim() || !formState.password) {
        setErrorMessage(t('login.errors.requiredFields'));
        return;
      }

      setIsSubmitting(true);
      const result = await login(
        formState.username.trim(),
        formState.password,
        formState.totpCode.trim() || undefined,
      );
      if (!result.success) {
        if (result.totpRequired) {
          setTotpPrompted(true);
        }
        setErrorMessage(result.error);
      }
      setIsSubmitting(false);
    },
    [formState.password, formState.totpCode, formState.username, login, t],
  );

  return (
    <AuthScreenLayout
      title={t('login.title')}
      description={t('login.description')}
      footerText={t('login.footerText')}
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <AuthInputField
          id="username"
          label={t('login.username')}
          value={formState.username}
          onChange={(value) => updateField('username', value)}
          placeholder={t('login.placeholders.username')}
          isDisabled={isSubmitting}
          autoComplete="username"
          icon={User}
        />

        <AuthInputField
          id="password"
          label={t('login.password')}
          value={formState.password}
          onChange={(value) => updateField('password', value)}
          placeholder={t('login.placeholders.password')}
          isDisabled={isSubmitting}
          type="password"
          autoComplete="current-password"
          icon={Lock}
        />

        {showTotpInput && (
          <AuthInputField
            id="totpCode"
            label={t('login.totpCode', { defaultValue: '2FA Authentication Code (TOTP)' })}
            value={formState.totpCode}
            onChange={(value) => updateField('totpCode', value)}
            placeholder={t('login.placeholders.totpCode', {
              defaultValue: '6-digit code or backup recovery code',
            })}
            isDisabled={isSubmitting}
            autoComplete="one-time-code"
            required={false}
            icon={Shield}
          />
        )}

        <AuthErrorAlert errorMessage={errorMessage || sessionError || ''} />

        <button
          type="submit"
          disabled={isSubmitting}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 font-medium text-primary-foreground shadow-lg shadow-primary/25 transition-all duration-200 hover:shadow-primary/30 hover:brightness-110 focus:outline-none focus:ring-2 focus:ring-primary/40 focus:ring-offset-2 focus:ring-offset-card active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isSubmitting ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              {t('login.loading')}
            </>
          ) : (
            t('login.submit')
          )}
        </button>
      </form>
    </AuthScreenLayout>
  );
}
