export async function parseJsonSafely<T>(response: Response): Promise<T | null> {
  try {
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

export function resolveApiErrorMessage(payload: unknown, fallback: string = ''): string {
  if (typeof payload === 'string' && payload.trim()) {
    return payload.trim();
  }

  if (!payload || typeof payload !== 'object') {
    return fallback;
  }

  const record = payload as Record<string, unknown>;

  // Case 1: payload.error is a string
  if (typeof record.error === 'string' && record.error.trim()) {
    return record.error.trim();
  }

  // Case 2: payload.error is an object (e.g. { error: { code: "...", message: "..." } })
  if (record.error && typeof record.error === 'object') {
    const errorObj = record.error as Record<string, unknown>;
    if (typeof errorObj.message === 'string' && errorObj.message.trim()) {
      return errorObj.message.trim();
    }
  }

  // Case 3: payload.message is a string (or Error instance)
  if (typeof record.message === 'string' && record.message.trim()) {
    return record.message.trim();
  }

  return fallback;
}
