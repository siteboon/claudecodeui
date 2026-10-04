import assert from 'node:assert/strict';

import { render, screen } from '@testing-library/react';
import { beforeEach, test, vi } from 'vitest';

import '@/modules/i18n';
import type { ProviderAuthStatus } from '@/shared/types';

/**
 * Settings > Agents lists one tab per provider and opens on one of them. With
 * VITE_ENABLED_PROVIDERS (#349) it lists only the enabled providers and opens
 * on the default one, the first enabled.
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

const status: ProviderAuthStatus = {
  authenticated: false,
  email: null,
  method: null,
  error: null,
  loading: false,
};

const renderAgentsTab = async (serverList: string[]) => {
  enabledProviders = serverList;
  const { hydrateEnabledProviders } = await import('@/shared/enabledProviders');
  await hydrateEnabledProviders();
  const { default: AgentsSettingsTab } = await import(
    '@/modules/settings/tabs/agents-settings/AgentsSettingsTab'
  );
  render(
    <AgentsSettingsTab
      providerAuthStatus={{ claude: status, cursor: status, codex: status, opencode: status }}
      onProviderLogin={() => {}}
      claudePermissions={{ allowedTools: [], disallowedTools: [], skipPermissions: false }}
      onClaudePermissionsChange={() => {}}
      cursorPermissions={{ allowedCommands: [], disallowedCommands: [], skipPermissions: false }}
      onCursorPermissionsChange={() => {}}
      codexPermissionMode="default"
      onCodexPermissionModeChange={() => {}}
      projects={[]}
    />,
  );
};

const AGENT_NAMES = ['Claude', 'Cursor', 'Codex', 'OpenCode'];

/** Provider tabs in the selector, by their visible name, in rendered order. */
const listedAgents = () => screen
  .queryAllByRole('button')
  .map((button) => button.textContent?.trim() ?? '')
  .filter((name) => AGENT_NAMES.includes(name));

/** The account panel heads itself with the selected provider's name. */
const selectedAgent = () => AGENT_NAMES.find((name) => (
  screen.queryAllByText(name).some((element) => !element.closest('button'))
));

beforeEach(() => {
  vi.resetModules();
});

test('every provider is listed, Claude first and selected, when all are enabled', async () => {
  await renderAgentsTab(['claude', 'codex', 'cursor', 'opencode']);

  assert.deepEqual(listedAgents(), AGENT_NAMES);
  assert.equal(selectedAgent(), 'Claude');
});

test('only the enabled providers are listed and the first enabled one is selected', async () => {
  // Listed in the built-in order; the configured order only picks the default.
  await renderAgentsTab(['codex', 'claude']);

  assert.deepEqual(listedAgents(), ['Claude', 'Codex']);
  assert.equal(selectedAgent(), 'Codex');
});
