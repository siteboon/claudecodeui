import { useCallback, useState } from 'react';
import type { FormEvent } from 'react';
import { Loader2, LogOut } from 'lucide-react';

import { IS_PLATFORM } from '../../../../constants/config';
import { useAuth } from '../../../auth/context/AuthContext';
import { Button, Input } from '../../../../shared/view/ui';
import SettingsCard from '../SettingsCard';
import SettingsSection from '../SettingsSection';

type PasswordFormState = {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
};

const initialPasswordFormState: PasswordFormState = {
  currentPassword: '',
  newPassword: '',
  confirmPassword: '',
};

function validatePasswordForm(formState: PasswordFormState): string | null {
  if (!formState.currentPassword || !formState.newPassword || !formState.confirmPassword) {
    return 'Fill in all password fields.';
  }

  if (formState.newPassword.length < 6) {
    return 'New password must be at least 6 characters.';
  }

  if (formState.newPassword !== formState.confirmPassword) {
    return 'New passwords do not match.';
  }

  return null;
}

export default function AccountSettingsTab() {
  const { user, logout, changePassword } = useAuth();
  const [passwordForm, setPasswordForm] = useState<PasswordFormState>(initialPasswordFormState);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const updatePasswordField = useCallback((field: keyof PasswordFormState, value: string) => {
    setPasswordForm((previous) => ({ ...previous, [field]: value }));
  }, []);

  const handlePasswordSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setError(null);

      const validationError = validatePasswordForm(passwordForm);
      if (validationError) {
        setError(validationError);
        return;
      }

      setIsSaving(true);
      const result = await changePassword(passwordForm.currentPassword, passwordForm.newPassword);
      if (!result.success) {
        setError(result.error);
        setIsSaving(false);
        return;
      }

      setPasswordForm(initialPasswordFormState);
      setIsSaving(false);
    },
    [changePassword, passwordForm],
  );

  return (
    <div className="space-y-8">
      <SettingsSection
        title="Account"
        description="Manage the local CloudCLI account for this installation."
      >
        <SettingsCard className="p-4">
          {IS_PLATFORM ? (
            <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
              Local account controls are not available in platform mode.
            </div>
          ) : (
            <div className="space-y-6">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-foreground">Signed in as {user?.username || 'local user'}</div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Logout removes the saved browser token. Your auth database stays intact.
                  </p>
                </div>
                <Button type="button" variant="outline" onClick={logout} className="sm:flex-shrink-0">
                  <LogOut className="h-4 w-4" />
                  Logout
                </Button>
              </div>

              <div className="border-t border-border pt-6">
                <form onSubmit={handlePasswordSubmit} className="space-y-4">
                  <div>
                    <h3 className="text-sm font-medium text-foreground">Change Password</h3>
                    <p className="mt-1 text-sm text-muted-foreground">
                      After the password changes, CloudCLI signs you out and rejects older session tokens.
                    </p>
                  </div>

                  <div className="grid gap-4 sm:grid-cols-3">
                    <div>
                      <label htmlFor="account-current-password" className="mb-2 block text-sm font-medium text-foreground">
                        Current password
                      </label>
                      <Input
                        id="account-current-password"
                        type="password"
                        autoComplete="current-password"
                        value={passwordForm.currentPassword}
                        onChange={(event) => updatePasswordField('currentPassword', event.target.value)}
                        disabled={isSaving}
                      />
                    </div>

                    <div>
                      <label htmlFor="account-new-password" className="mb-2 block text-sm font-medium text-foreground">
                        New password
                      </label>
                      <Input
                        id="account-new-password"
                        type="password"
                        autoComplete="new-password"
                        value={passwordForm.newPassword}
                        onChange={(event) => updatePasswordField('newPassword', event.target.value)}
                        disabled={isSaving}
                      />
                    </div>

                    <div>
                      <label htmlFor="account-confirm-password" className="mb-2 block text-sm font-medium text-foreground">
                        Confirm password
                      </label>
                      <Input
                        id="account-confirm-password"
                        type="password"
                        autoComplete="new-password"
                        value={passwordForm.confirmPassword}
                        onChange={(event) => updatePasswordField('confirmPassword', event.target.value)}
                        disabled={isSaving}
                      />
                    </div>
                  </div>

                  {error && (
                    <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200">
                      {error}
                    </div>
                  )}

                  <Button type="submit" disabled={isSaving}>
                    {isSaving && <Loader2 className="h-4 w-4 animate-spin" />}
                    Change Password
                  </Button>
                </form>
              </div>
            </div>
          )}
        </SettingsCard>
      </SettingsSection>
    </div>
  );
}
