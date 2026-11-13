export type PasswordFormState = {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
};

const PASSWORD_MIN_LENGTH = 6;

export function validatePasswordForm(formState: PasswordFormState): string | null {
  if (!formState.currentPassword || !formState.newPassword || !formState.confirmPassword) {
    return 'Fill in all password fields.';
  }

  if (formState.newPassword.length < PASSWORD_MIN_LENGTH) {
    return `New password must be at least ${PASSWORD_MIN_LENGTH} characters.`;
  }

  if (formState.newPassword !== formState.confirmPassword) {
    return 'New passwords do not match.';
  }

  return null;
}
