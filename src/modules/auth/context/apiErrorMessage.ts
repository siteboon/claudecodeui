/**
 * Error bodies the auth endpoints produce. The auth middleware answers with a
 * bare `{ error: 'string' }`, while the global error middleware serialises an
 * `AppError` as `{ success: false, error: { code, message, details } }`.
 */
export type ApiErrorPayload = {
  error?: string | { code?: string; message?: string; details?: unknown };
  message?: string;
};

/**
 * Picks the human-readable message out of an auth error body, whatever its
 * shape. Returning the structured `error` object itself sent it into
 * `AuthErrorAlert` as a React child, which throws and unmounts the login
 * screen.
 */
export function resolveApiErrorMessage(payload: ApiErrorPayload | null, fallback: string): string {
  if (!payload) {
    return fallback;
  }

  const { error, message } = payload;
  if (typeof error === 'string' && error) {
    return error;
  }
  if (error && typeof error === 'object' && typeof error.message === 'string' && error.message) {
    return error.message;
  }
  if (typeof message === 'string' && message) {
    return message;
  }

  return fallback;
}
