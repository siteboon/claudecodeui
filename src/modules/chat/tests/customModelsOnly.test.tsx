import assert from 'node:assert/strict';

import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { beforeEach, test, vi } from 'vitest';

import '@/modules/i18n';
import ModelLibraryPanel from '@/modules/chat/modals/ModelLibraryPanel';
import { resetUserPreferences } from '@/shared/userSettings';
import type {
  LLMProvider,
  ProviderModelActions,
  ProviderModelOption,
  ProviderModelsDefinition,
} from '@/shared/types';

/**
 * #1513: a provider pointed at a gateway can be restricted to its custom
 * models. The server owns the filtering; these tests pin the client half: the
 * Model Library exposes the per-provider toggle, and the composer follows the
 * catalog the toggle returns.
 */

const BUILT_IN: ProviderModelOption = { value: 'default', label: 'Default', isCustom: false };
const GATEWAY_SONNET: ProviderModelOption = {
  value: 'claude-sonnet-4-6',
  label: 'Gateway Sonnet',
  recordId: 1,
  isCustom: true,
};
const GATEWAY_HAIKU: ProviderModelOption = {
  value: 'claude-haiku-4-5',
  label: 'Gateway Haiku',
  recordId: 2,
  isCustom: true,
};

const MERGED_CATALOG: ProviderModelsDefinition = {
  OPTIONS: [BUILT_IN, GATEWAY_SONNET, GATEWAY_HAIKU],
  DEFAULT: 'default',
  EFFORT_LEVELS: [],
  CUSTOM_MODELS_ONLY: false,
};
const CUSTOM_ONLY_CATALOG: ProviderModelsDefinition = {
  OPTIONS: [GATEWAY_SONNET, GATEWAY_HAIKU],
  DEFAULT: 'claude-sonnet-4-6',
  EFFORT_LEVELS: [],
  CUSTOM_MODELS_ONLY: true,
};

const toggleRequests: Array<{ provider: string; enabled: boolean }> = [];

const okJson = (data: unknown) => Promise.resolve({
  ok: true,
  json: async () => data,
});

vi.mock('@/shared/api', () => ({
  api: {
    user: {
      preferences: () => okJson({ success: true, preferences: {} }),
      savePreferences: () => okJson({ success: true, preferences: {} }),
    },
    providers: {
      models: (provider: LLMProvider) => okJson({
        success: true,
        data: provider === 'claude' ? { models: MERGED_CATALOG } : null,
      }),
      setCustomModelsOnly: (provider: string, enabled: boolean) => {
        toggleRequests.push({ provider, enabled });
        return okJson({
          success: true,
          data: { provider, models: enabled ? CUSTOM_ONLY_CATALOG : MERGED_CATALOG },
        });
      },
      capabilities: () => okJson({ success: true, data: null }),
      sessionActiveModel: () => okJson({ success: true, data: null }),
      setSessionActiveModel: () => okJson({ success: true, data: null }),
      setSessionActiveEffort: () => okJson({ success: true, data: null }),
    },
  },
}));

const createActions = (setCustomModelsOnly: ProviderModelActions['setCustomModelsOnly']) => ({
  create: async () => {},
  update: async () => {},
  remove: async () => {},
  setCustomModelsOnly,
}) satisfies ProviderModelActions;

beforeEach(() => {
  localStorage.clear();
  resetUserPreferences();
  toggleRequests.length = 0;
});

test('the model library toggles "use only my models" for the selected provider', async () => {
  const calls: Array<{ provider: LLMProvider; enabled: boolean }> = [];
  const actions = createActions(async (provider, enabled) => {
    calls.push({ provider, enabled });
  });
  render(
    <ModelLibraryPanel
      initialProvider="claude"
      providerModelCatalog={{ claude: MERGED_CATALOG }}
      actions={actions}
    />,
  );

  const toggle = screen.getByRole('checkbox', { name: /Use only my models/ });
  assert.equal((toggle as HTMLInputElement).checked, false);
  screen.getByText(/Hide the built-in Claude models from every model picker/);

  fireEvent.click(toggle);
  await waitFor(() => assert.deepEqual(calls, [{ provider: 'claude', enabled: true }]));
});

test('the model library shows the flag and says the built-ins are hidden', () => {
  const actions = createActions(async () => {});
  render(
    <ModelLibraryPanel
      initialProvider="claude"
      providerModelCatalog={{ claude: CUSTOM_ONLY_CATALOG }}
      actions={actions}
    />,
  );

  const toggle = screen.getByRole('checkbox', { name: /Use only my models/ });
  assert.equal((toggle as HTMLInputElement).checked, true);
  screen.getByText('Hidden from model pickers while “Use only my models” is on.');
  assert.equal(screen.queryByText('Default'), null);
});

test('with the flag on but no custom models the built-ins stay listed', () => {
  const actions = createActions(async () => {});
  render(
    <ModelLibraryPanel
      initialProvider="claude"
      providerModelCatalog={{
        claude: { OPTIONS: [BUILT_IN], DEFAULT: 'default', CUSTOM_MODELS_ONLY: true },
      }}
      actions={actions}
    />,
  );

  assert.equal((screen.getByRole('checkbox', { name: /Use only my models/ }) as HTMLInputElement).checked, true);
  screen.getByText('Default');
  assert.equal(screen.queryByText(/Hidden from model pickers/), null);
});

test('a failed toggle is reported next to it', async () => {
  const actions = createActions(async () => {
    throw new Error('boom');
  });
  render(
    <ModelLibraryPanel
      initialProvider="claude"
      providerModelCatalog={{ claude: MERGED_CATALOG }}
      actions={actions}
    />,
  );

  fireEvent.click(screen.getByRole('checkbox', { name: /Use only my models/ }));
  await waitFor(() => screen.getByText('Unable to change this setting.'));
});

test('turning the flag on moves the composer off a built-in that is no longer listed', async () => {
  localStorage.setItem('claude-model', 'default');
  const { useChatProviderState } = await import('@/modules/chat/hooks/useChatProviderState');
  const { result } = renderHook(() => useChatProviderState({ selectedSession: null, selectedProject: null }));

  await waitFor(() => assert.equal(result.current.providerModelsLoading, false));
  assert.equal(result.current.currentProviderModel, 'default');

  await act(async () => {
    await result.current.providerModelActions.setCustomModelsOnly('claude', true);
  });

  assert.deepEqual(toggleRequests, [{ provider: 'claude', enabled: true }]);
  assert.deepEqual(
    result.current.currentProviderModelOptions.map((option) => option.value),
    ['claude-sonnet-4-6', 'claude-haiku-4-5'],
  );
  await waitFor(() => assert.equal(result.current.currentProviderModel, 'claude-sonnet-4-6'));
  assert.equal(localStorage.getItem('claude-model'), 'claude-sonnet-4-6');
});
