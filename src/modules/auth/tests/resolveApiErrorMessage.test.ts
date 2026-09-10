import assert from 'node:assert/strict';

import { test } from 'vitest';

import { resolveApiErrorMessage } from '@/modules/auth/context/apiErrorMessage';

const FALLBACK = 'Login failed';

// The global error middleware wraps every AppError (invalid credentials,
// missing fields, password too short, ...) in a structured envelope. Handing
// that object to the alert as a React child threw and blanked the login screen.
test('resolveApiErrorMessage: reads the message out of the structured error envelope', () => {
  const payload = {
    success: false,
    error: { code: 'AUTH_INVALID_CREDENTIALS', message: 'Invalid username or password' },
  };
  const resolved: string = resolveApiErrorMessage(payload, FALLBACK);
  assert.equal(resolved, 'Invalid username or password');
});

test('resolveApiErrorMessage: keeps the bare string shape the auth middleware sends', () => {
  assert.equal(resolveApiErrorMessage({ error: 'Invalid API key' }, FALLBACK), 'Invalid API key');
});

test('resolveApiErrorMessage: falls back to a top-level message', () => {
  assert.equal(resolveApiErrorMessage({ message: 'Too many attempts' }, FALLBACK), 'Too many attempts');
});

test('resolveApiErrorMessage: never returns anything but a string', () => {
  assert.equal(resolveApiErrorMessage(null, FALLBACK), FALLBACK);
  assert.equal(resolveApiErrorMessage({}, FALLBACK), FALLBACK);
  assert.equal(resolveApiErrorMessage({ error: '' }, FALLBACK), FALLBACK);
  assert.equal(resolveApiErrorMessage({ error: { code: 'INTERNAL_ERROR' } }, FALLBACK), FALLBACK);
  assert.equal(resolveApiErrorMessage({ error: { message: '' } }, FALLBACK), FALLBACK);
});

test('resolveApiErrorMessage: treats blank and whitespace-only messages as absent', () => {
  expect(resolveApiErrorMessage({ error: '   ' }, 'fallback')).toBe('fallback');
  expect(resolveApiErrorMessage({ error: { message: '\n\t' } }, 'fallback')).toBe('fallback');
  expect(resolveApiErrorMessage({ error: '  ', message: '   ' }, 'fallback')).toBe('fallback');
  expect(resolveApiErrorMessage({ error: '  Invalid credentials  ' }, 'fallback')).toBe('Invalid credentials');
});

