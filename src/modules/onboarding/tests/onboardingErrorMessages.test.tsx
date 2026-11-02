import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import '@/modules/i18n';

// The git-config route hands failures to the global error middleware, which
// answers with the structured AppError envelope.
const { updateGitConfig, providerAuth } = vi.hoisted(() => ({
  updateGitConfig: vi.fn(async () => new Response(
    JSON.stringify({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } }),
    { status: 500, headers: { 'Content-Type': 'application/json' } },
  )),
  // Stable references: Onboarding refreshes the statuses from an effect.
  providerAuth: {
    providerAuthStatus: {},
    checkProviderAuthStatus: async () => {},
    refreshProviderAuthStatuses: async () => {},
  },
}));

vi.mock('@/shared/api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  api: {
    user: {
      gitConfig: async () => new Response(JSON.stringify({ success: true }), { status: 200 }),
      updateGitConfig,
    },
  },
}));

vi.mock('@/modules/provider-auth', () => ({
  ProviderLoginModal: () => null,
  useProviderAuthStatus: () => providerAuth,
}));

const { Onboarding } = await import('@/modules/onboarding');

describe('Onboarding surfaces server errors as text', () => {
  it('shows the message of the structured envelope when saving the git identity fails', async () => {
    render(<Onboarding />);

    fireEvent.change(screen.getByLabelText(/Git Name/), { target: { value: 'Triage' } });
    fireEvent.change(screen.getByLabelText(/Git Email/), { target: { value: 'triage@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: /Next/ }));

    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Internal server error');
    expect(updateGitConfig).toHaveBeenCalledWith('Triage', 'triage@example.com');
  });
});
