import assert from 'node:assert/strict';

import { act, fireEvent, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { beforeEach, test, vi } from 'vitest';

import '@/modules/i18n';
import ModelLibraryPanel from '@/modules/chat/modals/ModelLibraryPanel';
import ProviderSelectionEmptyState from '@/modules/chat/transcript/ProviderSelectionEmptyState';
import { hydrateEnabledProviders } from '@/shared/enabledProviders';
import type { LLMProvider, ProviderModelActions, ProviderModelsDefinition } from '@/shared/types';

/**
 * The new-chat model picker groups models by provider, and its "Add model"
 * library has one tab per provider. With VITE_ENABLED_PROVIDERS (#349) both
 * must list only the enabled providers.
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
    user: {
      preferences: () => Promise.resolve({ ok: true, json: async () => ({ preferences: {} }) }),
      savePreferences: () => Promise.resolve({ ok: true, json: async () => ({}) }),
    },
  },
}));

// cmdk measures its list and scrolls the active item into view; jsdom has neither.
globalThis.ResizeObserver = class {
  observe() {}

  unobserve() {}

  disconnect() {}
} as unknown as typeof ResizeObserver;
Element.prototype.scrollIntoView = () => {};

const ALL_PROVIDERS = ['claude', 'codex', 'cursor', 'opencode'];

// One model per provider: cmdk drops a group that has no items at all.
const catalog: Partial<Record<LLMProvider, ProviderModelsDefinition>> = Object.fromEntries(
  ALL_PROVIDERS.map((provider) => [
    provider,
    { OPTIONS: [{ value: `${provider}-model`, label: `${provider} model` }], DEFAULT: `${provider}-model` },
  ]),
);

const noopActions: ProviderModelActions = {
  create: async () => {},
  update: async () => {},
  remove: async () => {},
};

// Every test sets the whole list, so the store singleton needs no reset.
const hydrate = async (serverList: string[]) => {
  enabledProviders = serverList;
  await hydrateEnabledProviders();
};

/** Opens the new-chat picker and returns its provider group names, in order. */
const listPickerGroups = async (serverList: string[], provider: LLMProvider) => {
  await hydrate(serverList);
  render(
    <ProviderSelectionEmptyState
      selectedSession={null}
      currentSessionId={null}
      provider={provider}
      setProvider={() => {}}
      textareaRef={createRef<HTMLTextAreaElement>()}
      providerModels={{
        claude: 'claude-model',
        codex: 'codex-model',
        cursor: 'cursor-model',
        opencode: 'opencode-model',
      }}
      setProviderModel={() => {}}
      providerModelCatalog={catalog}
      providerModelActions={noopActions}
      providerModelsLoading={false}
      tasksEnabled={false}
      isTaskMasterInstalled={false}
      setInput={() => {}}
    />,
  );

  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /click to change model/i }));
  });

  return Array.from(document.querySelectorAll('button[aria-expanded]'))
    .map((button) => button.textContent?.replace(/\d+$/, '').trim());
};

/** Renders the model library and returns its provider tab names, in order. */
const listLibraryTabs = async (serverList: string[], initialProvider: LLMProvider) => {
  await hydrate(serverList);
  render(
    <ModelLibraryPanel
      initialProvider={initialProvider}
      providerModelCatalog={catalog}
      actions={noopActions}
    />,
  );

  return Array.from(document.querySelectorAll('button[aria-pressed]'))
    .map((button) => button.textContent?.trim());
};

beforeEach(() => {
  localStorage.clear();
});

test('the new-chat picker groups every provider when all are enabled', async () => {
  assert.deepEqual(
    await listPickerGroups(ALL_PROVIDERS, 'claude'),
    ['Anthropic', 'OpenAI', 'Cursor', 'OpenCode'],
  );
});

test('the new-chat picker groups only the enabled providers', async () => {
  assert.deepEqual(await listPickerGroups(['codex', 'claude'], 'codex'), ['Anthropic', 'OpenAI']);
});

test('the model library has a tab per provider when all are enabled', async () => {
  assert.deepEqual(
    await listLibraryTabs(ALL_PROVIDERS, 'claude'),
    ['Claude', 'Codex', 'Cursor', 'OpenCode'],
  );
});

test('the model library lists only the enabled providers', async () => {
  assert.deepEqual(await listLibraryTabs(['claude'], 'claude'), ['Claude']);
});

test('the model library keeps the tab of a disabled provider it was opened for', async () => {
  // `/model` in a session made with a since-disabled provider opens the
  // library on that provider; its tab must not be missing from the bar.
  assert.deepEqual(await listLibraryTabs(['claude'], 'cursor'), ['Claude', 'Cursor']);
});
