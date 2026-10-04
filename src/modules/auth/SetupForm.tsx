import { useCallback, useState } from 'react';
import type { FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, Lock, Shield, ShieldCheck, User } from 'lucide-react';

import { useAuth } from '@/modules/auth/context/AuthContext';
import AuthErrorAlert from '@/modules/auth/AuthErrorAlert';
import AuthInputField from '@/modules/auth/AuthInputField';
import AuthScreenLayout from '@/modules/auth/AuthScreenLayout';
import TotpEnrollmentStep from '@/modules/auth/TotpEnrollmentStep';

type SetupFormState = {
  username: string;
  password: string;
  confirmPassword: string;
};

const initialState: SetupFormState = {
  username: '',
  password: '',
  confirmPassword: '',
};

/**
 * Validates the account-setup form state.
 * @returns An error message string if validation fails, or `null` when the
 *   form is valid.
 */
function validateSetupForm(formState: SetupFormState, t: (key: string) => string): string | null {
  if (!formState.username.trim() || !formState.password || !formState.confirmPassword) {
    return t('register.errors.requiredFields');
  }

  if (formState.username.trim().length < 3) {
    return t('register.errors.usernameLength');
  }

  if (formState.password.length < 6) {
    return t('register.errors.passwordLength');
  }

  if (formState.password !== formState.confirmPassword) {
    return t('register.errors.passwordMismatch');
  }

  return null;
}

/**
 * Account setup / registration form.
 * Rendered by the auth module's ProtectedRoute when the server reports that no account exists yet.
 * Allows optional RFC 6238 TOTP 2FA linking immediately upon account creation.
 */
export default function SetupForm() {
  const { t } = useTranslation('auth');
  const { register, completeDeferredSession } = useAuth();

  const [formState, setFormState] = useState<SetupFormState>(initialState);
  const [setupTotpOnCreate, setSetupTotpOnCreate] = useState(false);
  const [showTotpStep, setShowTotpStep] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const updateField = useCallback((field: keyof SetupFormState, value: string) => {
    setFormState((previous) => ({ ...previous, [field]: value }));
  }, []);

  const handleSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setErrorMessage('');

      const validationError = validateSetupForm(formState, t);
      if (validationError) {
        setErrorMessage(validationError);
        return;
      }

      setIsSubmitting(true);
      const result = await register(formState.username.trim(), formState.password, {
        deferPublish: setupTotpOnCreate,
      });
      if (!result.success) {
        setErrorMessage(result.error);
        setIsSubmitting(false);
        return;
      }

      if (setupTotpOnCreate) {
        setShowTotpStep(true);
      }
      setIsSubmitting(false);
    },
    [formState, register, setupTotpOnCreate, t],
  );

  if (showTotpStep) {
    return (
      <AuthScreenLayout
        title={t('totp.setupTitle', { defaultValue: 'Link Two-Factor Authentication' })}
        description={t('totp.setupDescription', {
          defaultValue: 'Scan the QR code with your authenticator app and enter the 6-digit code.',
        })}
        footerText={t('register.footerText')}
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
      title={t('register.title')}
      description={t('register.description')}
      footerText={t('register.footerText')}
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <AuthInputField
          id="username"
          name="username"
          label={t('register.username')}
          value={formState.username}
          onChange={(value) => updateField('username', value)}
          placeholder={t('register.placeholderUsername')}
          isDisabled={isSubmitting}
          autoComplete="username"
          icon={User}
        />

        <AuthInputField
          id="password"
          name="password"
          label={t('register.password')}
          value={formState.password}
          onChange={(value) => updateField('password', value)}
          placeholder={t('register.placeholderPassword')}
          isDisabled={isSubmitting}
          type="password"
          autoComplete="new-password"
          icon={Lock}
        />

        <AuthInputField
          id="confirmPassword"
          name="confirmPassword"
          label={t('register.confirmPassword')}
          value={formState.confirmPassword}
          onChange={(value) => updateField('confirmPassword', value)}
          placeholder={t('register.placeholderConfirm')}
          isDisabled={isSubmitting}
          type="password"
          autoComplete="new-password"
          icon={ShieldCheck}
        />

        <label className="flex cursor-pointer items-center gap-2.5 rounded-xl border border-border bg-muted/30 px-3.5 py-2.5 text-xs font-medium text-foreground transition-colors hover:bg-muted/50">
          <input
            type="checkbox"
            checked={setupTotpOnCreate}
            onChange={(event) => setSetupTotpOnCreate(event.target.checked)}
            disabled={isSubmitting}
            className="h-4 w-4 rounded border-border text-primary focus:ring-primary/40"
          />
          <Shield className="h-3.5 w-3.5 text-primary" />
          <span>
            {t('register.linkTotpOptional', {
              defaultValue: 'Also set up Two-Factor Authentication (TOTP) now (Optional)',
            })}
          </span>
        </label>

        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <ShieldCheck className="h-3.5 w-3.5" />
          {t('register.hint')}
        </p>

        <AuthErrorAlert errorMessage={errorMessage} />

        <button
          type="submit"
          disabled={isSubmitting}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 font-medium text-primary-foreground shadow-lg shadow-primary/25 transition-all duration-200 hover:shadow-primary/30 hover:brightness-110 focus:outline-none focus:ring-2 focus:ring-primary/40 focus:ring-offset-2 focus:ring-offset-card active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isSubmitting ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              {t('register.settingUp')}
            </>
          ) : (
            t('register.submit')
          )}
        </button>
      </form>
    </AuthScreenLayout>
  );
}
