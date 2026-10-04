import { useCallback, useState } from 'react';
import type { FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, Lock, Shield, User } from 'lucide-react';

import { useAuth } from '@/modules/auth/context/AuthContext';
import AuthErrorAlert from '@/modules/auth/AuthErrorAlert';
import AuthInputField from '@/modules/auth/AuthInputField';
import AuthScreenLayout from '@/modules/auth/AuthScreenLayout';
import TotpEnrollmentStep from '@/modules/auth/TotpEnrollmentStep';

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
 * Supports optional TOTP 2FA linking when signing in with username and password,
 * and enforces 6-digit TOTP verification when 2FA is already enabled on the account.
 */
export default function LoginForm() {
  const { t } = useTranslation('auth');
  const { error: sessionError, login, totpEnabled, completeDeferredSession } = useAuth();

  const [formState, setFormState] = useState<LoginFormState>(initialState);
  const [enrollTotpOnLogin, setEnrollTotpOnLogin] = useState(false);
  const [showTotpEnrollmentStep, setShowTotpEnrollmentStep] = useState(false);
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

      if (!formState.username.trim() || !formState.password) {
        setErrorMessage(t('login.errors.requiredFields'));
        return;
      }

      setIsSubmitting(true);
      const shouldDeferForTotpSetup = !showTotpInput && enrollTotpOnLogin;
      const result = await login(
        formState.username.trim(),
        formState.password,
        formState.totpCode.trim() || undefined,
        { deferPublish: shouldDeferForTotpSetup },
      );

      if (!result.success) {
        if (result.totpRequired) {
          setTotpPrompted(true);
        }
        setErrorMessage(result.error);
        setIsSubmitting(false);
        return;
      }

      if (shouldDeferForTotpSetup) {
        setShowTotpEnrollmentStep(true);
      }
      setIsSubmitting(false);
    },
    [
      enrollTotpOnLogin,
      formState.password,
      formState.totpCode,
      formState.username,
      login,
      showTotpInput,
      t,
    ],
  );

  if (showTotpEnrollmentStep) {
    return (
      <AuthScreenLayout
        title={t('totp.setupTitle', { defaultValue: 'Link Two-Factor Authentication' })}
        description={t('totp.setupDescription', {
          defaultValue: 'Scan the QR code with your authenticator app and enter the 6-digit code.',
        })}
        footerText={t('login.footerText')}
      >
        <TotpEnrollmentStep
          onComplete={completeDeferredSession}
          onSkip={completeDeferredSession}
        />
      </AuthScreenLayout>
    );
  }

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

        {showTotpInput ? (
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
        ) : (
          <label className="flex cursor-pointer items-center gap-2.5 rounded-xl border border-border bg-muted/30 px-3.5 py-2.5 text-xs font-medium text-foreground transition-colors hover:bg-muted/50">
            <input
              type="checkbox"
              checked={enrollTotpOnLogin}
              onChange={(event) => setEnrollTotpOnLogin(event.target.checked)}
              disabled={isSubmitting}
              className="h-4 w-4 rounded border-border text-primary focus:ring-primary/40"
            />
            <Shield className="h-3.5 w-3.5 text-primary" />
            <span>
              {t('login.linkTotpOptional', {
                defaultValue: 'Set up Two-Factor Authentication (TOTP) after sign-in (Optional)',
              })}
            </span>
          </label>
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
