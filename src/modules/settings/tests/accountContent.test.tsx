import { describe, expect, it } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';

import '@/modules/i18n';
import AccountContent from '@/modules/settings/tabs/agents-settings/sections/content/AccountContent';
import type { ProviderAuthStatus } from '@/shared/types';

const connectedStatus = (overrides: Partial<ProviderAuthStatus>): ProviderAuthStatus => ({
  authenticated: true,
  email: null,
  method: null,
  error: null,
  loading: false,
  ...overrides,
});

describe('the Claude account card', () => {
  it('shows a cloud provider connection without offering a Claude re-login', () => {
    // Signing in to an Anthropic account does nothing while the CLI is routed
    // through Vertex AI, so the card must not suggest it.
    render(
      <AccountContent
        agent="claude"
        authStatus={connectedStatus({ email: 'Google Vertex AI (my-gcp-project)', method: 'cloud_provider' })}
        onLogin={() => {}}
      />,
    );

    expect(screen.getByText('Logged in as Google Vertex AI (my-gcp-project)')).toBeTruthy();
    expect(screen.getByText('Connected')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /re-login/i })).toBeNull();
  });

  it('still offers a re-login for a Claude account login', () => {
    render(
      <AccountContent
        agent="claude"
        authStatus={connectedStatus({ email: 'someone@example.com', method: 'credentials_file' })}
        onLogin={() => {}}
      />,
    );

    expect(screen.getByText('Logged in as someone@example.com')).toBeTruthy();
    expect(screen.getByRole('button', { name: /re-login/i })).toBeTruthy();
  });
});
