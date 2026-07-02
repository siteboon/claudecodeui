import { useCallback, useState } from 'react';
import type { FormEvent } from 'react';
import { Loader2, Lock, ShieldCheck, User } from 'lucide-react';

import { useAuth } from '../context/AuthContext';

import AuthErrorAlert from './AuthErrorAlert';
import AuthInputField from './AuthInputField';
import AuthScreenLayout from './AuthScreenLayout';

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
function validateSetupForm(formState: SetupFormState): string | null {
  if (!formState.username.trim() || !formState.password || !formState.confirmPassword) {
    return 'Please fill in all fields.';
  }

  if (formState.username.trim().length < 3) {
    return 'Username must be at least 3 characters long.';
  }

  if (formState.password.length < 6) {
    return 'Password must be at least 6 characters long.';
  }

  if (formState.password !== formState.confirmPassword) {
    return 'Passwords do not match.';
  }

  return null;
}

/**
 * Account setup / registration form.
 * Uses `autoComplete="new-password"` on password fields so that password
 * managers recognise this as a registration flow and offer to save the new
 * credentials after submission.
 */
export default function SetupForm() {
  const { register } = useAuth();

  const [formState, setFormState] = useState<SetupFormState>(initialState);
  const [errorMessage, setErrorMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const updateField = useCallback((field: keyof SetupFormState, value: string) => {
    setFormState((previous) => ({ ...previous, [field]: value }));
  }, []);

  const handleSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setErrorMessage('');

      const validationError = validateSetupForm(formState);
      if (validationError) {
        setErrorMessage(validationError);
        return;
      }

      setIsSubmitting(true);
      const result = await register(formState.username.trim(), formState.password);
      if (!result.success) {
        setErrorMessage(result.error);
      }
      setIsSubmitting(false);
    },
    [formState, register],
  );

  return (
    <AuthScreenLayout
      title="Welcome to CloudCLI"
      description="Set up your account to get started"
      footerText="This is a single-user system. Only one account can be created."
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <AuthInputField
          id="username"
          name="username"
          label="Username"
          value={formState.username}
          onChange={(value) => updateField('username', value)}
          placeholder="Choose a username"
          isDisabled={isSubmitting}
          autoComplete="username"
          icon={User}
        />

        <AuthInputField
          id="password"
          name="password"
          label="Password"
          value={formState.password}
          onChange={(value) => updateField('password', value)}
          placeholder="Create a password"
          isDisabled={isSubmitting}
          type="password"
          autoComplete="new-password"
          icon={Lock}
        />

        <AuthInputField
          id="confirmPassword"
          name="confirmPassword"
          label="Confirm Password"
          value={formState.confirmPassword}
          onChange={(value) => updateField('confirmPassword', value)}
          placeholder="Re-enter your password"
          isDisabled={isSubmitting}
          type="password"
          autoComplete="new-password"
          icon={ShieldCheck}
        />

        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <ShieldCheck className="h-3.5 w-3.5" />
          At least 3 characters for username, 6 for password.
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
              Setting up...
            </>
          ) : (
            'Create Account'
          )}
        </button>
      </form>
    </AuthScreenLayout>
  );
}
