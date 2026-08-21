export const AUTH_TOKEN_STORAGE_KEY = 'auth-token';

// Values are i18n keys — resolve through t() at usage time so messages follow
// the active language.
export const AUTH_ERROR_MESSAGES = {
  authStatusCheckFailed: 'auth:errors.authStatusCheckFailed',
  loginFailed: 'auth:errors.loginFailed',
  registrationFailed: 'auth:errors.registrationFailed',
  networkError: 'auth:errors.networkError',
  sessionExpired: 'auth:errors.sessionExpired',
} as const;
