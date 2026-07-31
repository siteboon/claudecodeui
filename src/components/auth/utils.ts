import type { ApiErrorPayload } from './types';

export async function parseJsonSafely<T>(response: Response): Promise<T | null> {
  try {
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

export function resolveApiErrorMessage(payload: ApiErrorPayload | null, fallback: string): string {
  if (!payload) {
    return fallback;
  }

  // The server returns errors as either a plain string or a structured
  // `{ code, message }` object. Rendering the raw object as a React child
  // crashes the tree, so the message string is always extracted here.
  const { error } = payload;
  if (typeof error === 'string') {
    return error;
  }
  if (error && typeof error === 'object' && typeof error.message === 'string') {
    return error.message;
  }

  return payload.message ?? fallback;
}
