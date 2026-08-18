import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { validatePasswordForm } from './accountSettings';

const source = readFileSync(new URL('./AccountSettingsTab.tsx', import.meta.url), 'utf8');

test('validates password form input', () => {
  assert.equal(
    validatePasswordForm({ currentPassword: '', newPassword: '', confirmPassword: '' }),
    'Fill in all password fields.',
  );
  assert.equal(
    validatePasswordForm({ currentPassword: 'old-password', newPassword: 'short', confirmPassword: 'short' }),
    'New password must be at least 6 characters.',
  );
  assert.equal(
    validatePasswordForm({
      currentPassword: 'old-password',
      newPassword: 'new-password',
      confirmPassword: 'different-password',
    }),
    'New passwords do not match.',
  );
  assert.equal(
    validatePasswordForm({
      currentPassword: 'old-password',
      newPassword: 'new-password',
      confirmPassword: 'new-password',
    }),
    null,
  );
});

test('announces account errors to assistive technology', () => {
  assert.match(source, /role="alert"/);
});
