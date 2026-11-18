import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { test } from 'vitest';

import { normalizeMainTab } from '@/modules/settings/hooks/normalizeMainTab';
import { validatePasswordForm } from '@/modules/settings/tabs/accountSettings';

const accountSettingsSource = readFileSync(
  resolve(process.cwd(), 'src/modules/settings/tabs/AccountSettingsTab.tsx'),
  'utf8',
);

test('normalizes account to the account settings tab', () => {
  assert.equal(normalizeMainTab('account'), 'account');
});

test('preserves the voice settings tab', () => {
  assert.equal(normalizeMainTab('voice'), 'voice');
});

test('preserves legacy and unknown settings tab fallbacks', () => {
  assert.equal(normalizeMainTab('tools'), 'agents');
  assert.equal(normalizeMainTab('unknown'), 'agents');
});

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
  assert.match(accountSettingsSource, /role="alert"/);
});
