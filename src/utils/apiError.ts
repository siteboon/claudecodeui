/**
 * The API speaks two error dialects: older routes reply `{ error: "message" }`,
 * while anything going through AppError and the global error middleware replies
 * `{ success: false, error: { code, message } }`. Reading `payload.error` blindly
 * therefore yields an object about half the time — which stringifies to
 * "[object Object]" in a message, and throws React error #31 (blank screen) if
 * it reaches JSX. This normalises both shapes to a string.
 */
export type ApiErrorPayload = {
  error?: string | { code?: string; message?: string } | null;
};

export const getApiErrorMessage = (
  payload: ApiErrorPayload | undefined | null,
  fallback: string,
): string => {
  const error = payload?.error;

  if (typeof error === 'string') {
    return error || fallback;
  }

  return error?.message || fallback;
};
