/**
 * Validate a password + confirmation pair.
 * Returns { ok: true } or { ok: false, error: string }.
 */
export function validatePassword(password, confirmation) {
  if (password.length < 6) {
    return { ok: false, error: 'Password must be at least 6 characters.' };
  }
  if (password !== confirmation) {
    return { ok: false, error: 'Passwords do not match.' };
  }
  return { ok: true };
}
