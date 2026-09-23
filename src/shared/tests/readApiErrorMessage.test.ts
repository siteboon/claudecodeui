import { describe, expect, it } from 'vitest';

import { readApiErrorMessage } from '@/shared/api';

describe('readApiErrorMessage', () => {
  it('reads the message out of the structured AppError envelope', () => {
    expect(
      readApiErrorMessage({
        success: false,
        error: { code: 'AUTH_INVALID_CREDENTIALS', message: 'Invalid username or password' },
      }),
    ).toBe('Invalid username or password');
  });

  it('keeps the legacy string envelope', () => {
    expect(readApiErrorMessage({ error: 'Invalid API key' })).toBe('Invalid API key');
  });

  it('falls back to a top-level message', () => {
    expect(readApiErrorMessage({ success: false, message: 'Too many attempts' })).toBe('Too many attempts');
  });

  it('returns null, never an object, when no readable message is present', () => {
    expect(readApiErrorMessage(null)).toBeNull();
    expect(readApiErrorMessage('Bad Gateway')).toBeNull();
    expect(readApiErrorMessage({})).toBeNull();
    expect(readApiErrorMessage({ error: { code: 'INTERNAL_ERROR' } })).toBeNull();
    expect(readApiErrorMessage({ error: { message: { nested: true } } })).toBeNull();
    expect(readApiErrorMessage({ error: '  ', message: '\n' })).toBeNull();
  });
});
