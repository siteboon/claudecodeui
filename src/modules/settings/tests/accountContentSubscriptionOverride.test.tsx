import { describe, expect, it } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';

import '@/modules/i18n';
import AccountContent from '@/modules/settings/tabs/agents-settings/sections/content/AccountContent';
import type { ProviderAuthStatus } from '@/shared/types';

// Issue #568: Claude Code prefers ANTHROPIC_API_KEY over the `claude /login`
// subscription without saying so. The account panel has to make the bypass
// visible — and only when the server says a valid login really is bypassed.

const NOTICE = 'provider-auth-subscription-override';

const apiKeyStatus = (overrides: Partial<ProviderAuthStatus> = {}): ProviderAuthStatus => ({
  authenticated: true,
  email: 'API Key Auth',
  method: 'api_key',
  error: null,
  loading: false,
  ...overrides,
});

const renderClaudeAccount = (authStatus: ProviderAuthStatus) =>
  render(<AccountContent agent="claude" authStatus={authStatus} onLogin={() => {}} />);

describe('AccountContent subscription override notice', () => {
  it('warns which variable is bypassing the login, where it came from, and how to fix it (process env)', () => {
    renderClaudeAccount(apiKeyStatus({
      subscriptionOverride: {
        variable: 'ANTHROPIC_API_KEY',
        source: 'process_env',
        subscriptionEmail: 'someone@example.com',
      },
    }));

    const notice = screen.getByTestId(NOTICE);
    expect(notice.getAttribute('role')).toBe('alert');
    expect(notice.textContent).toContain('Your subscription login is not being used');
    expect(notice.textContent).toContain('ANTHROPIC_API_KEY is set in the server environment');
    expect(notice.textContent).toContain('(someone@example.com)');
    expect(notice.textContent).toContain('unset ANTHROPIC_API_KEY');
    expect(notice.textContent).toContain('restart the server');
    // The existing status line is untouched.
    expect(screen.getByText('Logged in as API Key Auth')).toBeTruthy();
  });

  it('points at ~/.claude/settings.json when the key lives there, and drops the email when unknown', () => {
    renderClaudeAccount(apiKeyStatus({
      subscriptionOverride: {
        variable: 'ANTHROPIC_AUTH_TOKEN',
        source: 'settings_file',
        subscriptionEmail: null,
      },
    }));

    const text = screen.getByTestId(NOTICE).textContent ?? '';
    expect(text).toContain('ANTHROPIC_AUTH_TOKEN is set in ~/.claude/settings.json');
    expect(text).toContain('remove ANTHROPIC_AUTH_TOKEN from the "env" block of ~/.claude/settings.json');
    expect(text).not.toContain('restart the server');
    expect(text).not.toContain('(');
  });

  it('shows nothing extra for a plain API key login', () => {
    renderClaudeAccount(apiKeyStatus());

    expect(screen.queryByTestId(NOTICE)).toBeNull();
    expect(screen.getByText('Logged in as API Key Auth')).toBeTruthy();
  });

  it('shows nothing extra for a plain subscription login', () => {
    renderClaudeAccount(apiKeyStatus({ email: 'someone@example.com', method: 'credentials_file' }));

    expect(screen.queryByTestId(NOTICE)).toBeNull();
    expect(screen.getByText('Logged in as someone@example.com')).toBeTruthy();
  });

  it('holds the notice back while the status is still being checked', () => {
    renderClaudeAccount(apiKeyStatus({
      loading: true,
      subscriptionOverride: { variable: 'ANTHROPIC_API_KEY', source: 'process_env', subscriptionEmail: null },
    }));

    expect(screen.queryByTestId(NOTICE)).toBeNull();
  });
});
