import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { render } from '@testing-library/react';
import React from 'react';
import { test, vi } from 'vitest';

import type { ProviderAuthStatus } from '@/shared/types';

/**
 * Pi has no login command, so its account panel must walk the user through
 * install/configure (and show the credential source) instead of the generic
 * sign-in block the other providers get.
 */

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    // Keys are asserted verbatim so this test stays independent of locale files.
    t: (key: string) => key,
  }),
}));

const { default: AccountContent } = await import('@/modules/settings/tabs/agents-settings/sections/content/AccountContent');

const makeStatus = (overrides: Partial<ProviderAuthStatus> = {}): ProviderAuthStatus => ({
  authenticated: false,
  email: null,
  method: null,
  error: null,
  loading: false,
  ...overrides,
});

const onLogin = vi.fn();

test('an uninstalled pi shows the install command instead of a login prompt', () => {
  const { container } = render(
    <AccountContent
      agent="pi"
      authStatus={makeStatus({ installed: false })}
      onLogin={onLogin}
    />,
  );

  const text = container.textContent ?? '';
  assert.equal(text.includes('agents.pi.setup.installTitle'), true);
  assert.equal(text.includes('agents.pi.setup.installCommand'), true);
  assert.equal(text.includes('agents.login.title'), false);
});

test('an authenticated pi reports its credential source', () => {
  const { container } = render(
    <AccountContent
      agent="pi"
      authStatus={makeStatus({ authenticated: true, method: 'env' })}
      onLogin={onLogin}
    />,
  );

  const text = container.textContent ?? '';
  assert.equal(text.includes('agents.pi.authMethod.label'), true);
  assert.equal(text.includes('agents.pi.authMethod.env'), true);
  assert.equal(text.includes('agents.login.title'), false);
});

test('other providers keep the generic sign-in block', () => {
  const { container } = render(
    <AccountContent
      agent="claude"
      authStatus={makeStatus({ installed: false })}
      onLogin={onLogin}
    />,
  );

  const text = container.textContent ?? '';
  assert.equal(text.includes('agents.login.title'), true);
  assert.equal(text.includes('agents.pi.setup.'), false);
});

test('the en locale points the pi install guidance at the public package', () => {
  const settings = JSON.parse(
    readFileSync(
      path.join(process.cwd(), 'src/modules/i18n/locales/en/settings.json'),
      'utf8',
    ),
  ) as { agents: { pi: { setup: Record<string, string> } } };

  assert.equal(
    settings.agents.pi.setup.installCommand,
    'npm install -g @earendil-works/pi-coding-agent',
  );
});
