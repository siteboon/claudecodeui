import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import '@/modules/i18n';
import ChatDefaultsContent from '@/modules/settings/tabs/agents-settings/sections/content/ChatDefaultsContent';
import type { ChatDefaultsState } from '@/shared/types';

// Settings -> Agents -> Defaults: the model/effort a new session starts with.

const json = (body: unknown) => new Response(JSON.stringify(body), {
  status: 200,
  headers: { 'Content-Type': 'application/json' },
});

const CATALOG = {
  success: true,
  data: {
    models: {
      OPTIONS: [
        {
          value: 'best',
          label: 'Best',
          effort: { default: 'high', values: [{ value: 'low' }, { value: 'max' }] },
        },
        {
          value: 'sonnet',
          label: 'Sonnet',
          effort: { default: 'low', values: [{ value: 'low' }] },
        },
        { value: 'haiku', label: 'Haiku' },
      ],
      DEFAULT: 'best',
    },
  },
};

vi.mock('@/shared/api', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    api: {
      providers: {
        models: async () => json(CATALOG),
      },
    },
  };
});

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  document.body.innerHTML = '';
});

const renderContent = (defaults: ChatDefaultsState = {}) => {
  const onChange = vi.fn();
  render(
    <ChatDefaultsContent agent="claude" defaults={defaults} onDefaultsChange={onChange} />,
  );
  return { onChange };
};

test('choosing a model stores it as the provider default', async () => {
  const { onChange } = renderContent();
  const modelSelect = await screen.findByLabelText(/default model/i);

  await waitFor(() => {
    expect(screen.getByRole('option', { name: 'Best' })).toBeTruthy();
  });

  fireEvent.change(modelSelect, { target: { value: 'best' } });

  expect(onChange).toHaveBeenCalledWith({ claude: { model: 'best' } });
});

test('choosing an effort keeps the selected model', async () => {
  const { onChange } = renderContent({ claude: { model: 'best' } });
  const effortSelect = await screen.findByLabelText(/default reasoning effort/i);

  fireEvent.change(effortSelect, { target: { value: 'max' } });

  expect(onChange).toHaveBeenCalledWith({ claude: { model: 'best', effort: 'max' } });
});

test('an effort the new model cannot run is cleared instead of stored', async () => {
  const { onChange } = renderContent({ claude: { model: 'best', effort: 'max' } });
  const modelSelect = await screen.findByLabelText(/default model/i);

  await waitFor(() => {
    expect(screen.getByRole('option', { name: 'Sonnet' })).toBeTruthy();
  });

  fireEvent.change(modelSelect, { target: { value: 'sonnet' } });

  expect(onChange).toHaveBeenCalledWith({ claude: { model: 'sonnet' } });
});

test('a provider without effort support says so instead of offering a menu', async () => {
  renderContent({ claude: { model: 'haiku' } });

  await waitFor(() => {
    expect(screen.getByText(/not supported by this provider/i)).toBeTruthy();
  });
});
