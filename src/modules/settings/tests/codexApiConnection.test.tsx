import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';

import { i18n } from '@/modules/i18n';
import CodexApiConnection from '@/modules/settings/tabs/agents-settings/sections/content/CodexApiConnection';
import { api } from '@/shared/api';

beforeEach(async () => {
  await i18n.changeLanguage('en');
});

const result = (baseUrl: string, hasApiKey: boolean) => new Response(JSON.stringify({ success: true, data: { provider: 'aicode', baseUrl, hasApiKey } }), {
  headers: { 'content-type': 'application/json' },
});

test('saved keys stay empty in the form and a blank key preserves the server credential', async () => {
  vi.spyOn(api.providers, 'codexApiConnection').mockResolvedValue(result('https://example.com/v1', true));
  const save = vi.spyOn(api.providers, 'saveCodexApiConnection').mockResolvedValue(result('https://other.example/v1', true));
  const onSaved = vi.fn();
  render(<CodexApiConnection onSaved={onSaved} />);
  const address = screen.getByLabelText('Base URL');
  await waitFor(() => expect((address as HTMLInputElement).value).toBe('https://example.com/v1'));
  const key = screen.getByLabelText('API Key') as HTMLInputElement;
  expect(key.value).toBe('');
  expect(key.placeholder).toContain('leave blank');
  fireEvent.change(address, { target: { value: 'https://other.example/v1' } });
  fireEvent.click(screen.getByText('Save API configuration'));
  await waitFor(() => expect(save).toHaveBeenCalledWith({ provider: 'aicode', baseUrl: 'https://other.example/v1', apiKey: '' }));
  await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
  expect(key.value).toBe('');
});

test('new keys are sent only on save and erased from the form after saving', async () => {
  vi.spyOn(api.providers, 'codexApiConnection').mockResolvedValue(result('', false));
  const save = vi.spyOn(api.providers, 'saveCodexApiConnection').mockResolvedValue(result('https://example.com/v1', true));
  render(<CodexApiConnection />);
  const key = screen.getByLabelText('API Key') as HTMLInputElement;
  await waitFor(() => expect(key.disabled).toBe(false));
  fireEvent.change(screen.getByLabelText('Base URL'), { target: { value: 'https://example.com/v1' } });
  fireEvent.change(key, { target: { value: 'ui-test-secret' } });
  fireEvent.change(screen.getByLabelText('Provider ID'), { target: { value: 'my-api' } });
  expect(save).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText('Save API configuration'));
  await waitFor(() => expect(save).toHaveBeenCalledWith({ provider: 'my-api', baseUrl: 'https://example.com/v1', apiKey: 'ui-test-secret' }));
  await waitFor(() => expect(key.value).toBe(''));
  expect(document.body.textContent).not.toContain('ui-test-secret');
});
