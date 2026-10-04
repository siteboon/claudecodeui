import assert from 'node:assert/strict';

import { render, screen } from '@testing-library/react';
import { beforeEach, test, vi } from 'vitest';

import '@/modules/i18n';
import type { ProviderAuthStatusMap } from '@/shared/types';

/**
 * The onboarding agent step offers a login for each provider. With
 * VITE_ENABLED_PROVIDERS (#349) it must offer only the enabled ones.
 */

let enabledProviders: string[] = [];

vi.mock('@/shared/api', () => ({
  api: {
    providers: {
      enabled: () => Promise.resolve({
        ok: true,
        json: async () => ({ success: true, data: { providers: enabledProviders } }),
      }),
    },
  },
}));

const status = { authenticated: false, email: null, method: null, error: null, loading: false };
const statuses: ProviderAuthStatusMap = {
  claude: status,
  cursor: status,
  codex: status,
  opencode: status,
};

const renderStep = async (serverList: string[]) => {
  enabledProviders = serverList;
  const { hydrateEnabledProviders } = await import('@/shared/enabledProviders');
  await hydrateEnabledProviders();
  const { default: AgentConnectionsStep } = await import('@/modules/onboarding/AgentConnectionsStep');
  render(<AgentConnectionsStep providerStatuses={statuses} onOpenProviderLogin={() => {}} />);
};

const CARD_TITLES = ['Claude Code', 'Cursor', 'OpenAI Codex', 'OpenCode'];

/** Card titles in the order they are rendered. */
const listedCards = () => screen
  .queryAllByText((content) => CARD_TITLES.includes(content.trim()))
  .map((element) => element.textContent?.trim());

beforeEach(() => {
  vi.resetModules();
});

test('every provider is offered when the server enables all of them', async () => {
  await renderStep(['claude', 'codex', 'cursor', 'opencode']);

  assert.deepEqual(listedCards(), CARD_TITLES);
});

test('only the enabled providers are offered, in the built-in order', async () => {
  // The configured order only picks the default provider; the cards keep theirs.
  await renderStep(['codex', 'claude']);

  assert.deepEqual(listedCards(), ['Claude Code', 'OpenAI Codex']);
});
