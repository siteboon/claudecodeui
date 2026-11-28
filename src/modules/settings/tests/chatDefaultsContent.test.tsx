import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import '@/modules/i18n';
import ChatDefaultsContent from '@/modules/settings/tabs/agents-settings/sections/content/ChatDefaultsContent';
import type { ChatDefaultsState } from '@/shared/types';

// Settings -> Agents -> Defaults: the model/effort a new session starts with.

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
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

// Hoisted alongside the mock factory: the factory runs before module-level
// constants exist, so the swappable response has to live up there with it.
const { modelsResponse } = vi.hoisted(() => ({
  modelsResponse: { current: async (): Promise<Response> => new Response('{}') },
}));

vi.mock('@/shared/api', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    api: {
      providers: {
        models: (...args: unknown[]) => modelsResponse.current(...(args as [])),
      },
    },
  };
});

beforeEach(() => {
  vi.clearAllMocks();
  modelsResponse.current = async () => json(CATALOG);
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
});

const renderContent = (defaults: ChatDefaultsState = {}) => {
  const onChange = vi.fn();
  render(
    <ChatDefaultsContent agent="claude" defaults={defaults} onDefaultsChange={onChange} />,
  );
  return { onChange };
};

/** Opens the ActionMenu behind an accessible name and returns the trigger. */
const openMenu = async (name: RegExp) => {
  const trigger = await screen.findByRole('button', { name });
  await waitFor(() => {
    expect((trigger as HTMLButtonElement).disabled).toBe(false);
  });
  fireEvent.click(trigger);
  return trigger;
};

test('choosing a model stores it as the provider default', async () => {
  const { onChange } = renderContent();
  await openMenu(/default model/i);

  fireEvent.click(await screen.findByRole('menuitemradio', { name: 'Best' }));

  expect(onChange).toHaveBeenCalledWith({ claude: { model: 'best' } });
});

test('choosing an effort keeps the selected model', async () => {
  const { onChange } = renderContent({ claude: { model: 'best' } });
  await openMenu(/default reasoning effort/i);

  fireEvent.click(await screen.findByRole('menuitemradio', { name: 'max' }));

  expect(onChange).toHaveBeenCalledWith({ claude: { model: 'best', effort: 'max' } });
});

test('an effort the new model cannot run is cleared instead of stored', async () => {
  const { onChange } = renderContent({ claude: { model: 'best', effort: 'max' } });
  await openMenu(/default model/i);

  fireEvent.click(await screen.findByRole('menuitemradio', { name: 'Sonnet' }));

  expect(onChange).toHaveBeenLastCalledWith({ claude: { model: 'sonnet' } });
});

test('the selected model is exposed to assistive technology', async () => {
  // The tick icon alone says nothing to a screen reader; the row has to
  // report itself as the checked option of the group.
  renderContent({ claude: { model: 'best' } });
  await openMenu(/default model/i);

  expect((await screen.findByRole('menuitemradio', { name: 'Best' })).getAttribute('aria-checked')).toBe('true');
  expect(screen.getByRole('menuitemradio', { name: 'Sonnet' }).getAttribute('aria-checked')).toBe('false');
});

test('方向键在弹窗内打开和浏览模型菜单，Escape 将焦点还给触发按钮', async () => {
  render(
    <div role="dialog" aria-modal="true">
      <ChatDefaultsContent agent="claude" defaults={{}} onDefaultsChange={vi.fn()} />
    </div>,
  );
  const trigger = await screen.findByRole('button', { name: /default model/i });
  await waitFor(() => expect((trigger as HTMLButtonElement).disabled).toBe(false));
  trigger.focus();
  fireEvent.keyDown(trigger, { key: 'ArrowDown' });

  const menu = screen.getByRole('menu');
  const items = screen.getAllByRole('menuitemradio');
  expect(screen.getByRole('dialog').contains(menu)).toBe(true);
  expect(document.activeElement).toBe(items[0]);
  fireEvent.keyDown(items[0], { key: 'ArrowDown' });
  expect(document.activeElement).toBe(items[1]);
  fireEvent.keyDown(items[1], { key: 'ArrowUp' });
  expect(document.activeElement).toBe(items[0]);
  fireEvent.keyDown(items[0], { key: 'Escape' });
  expect(screen.queryByRole('menu')).toBeNull();
  expect(document.activeElement).toBe(trigger);
});

test('a provider without effort support says so instead of offering a menu', async () => {
  renderContent({ claude: { model: 'haiku' } });

  await waitFor(() => {
    expect(screen.getByText(/not supported by this provider/i)).toBeTruthy();
  });
});

test('a failed catalog keeps the controls disabled so a stored effort is not cleared', async () => {
  // With no catalog, "does this model support max?" has no answer. Letting the
  // user pick then treated the empty list as "no effort supported" and dropped
  // a configured default.
  modelsResponse.current = async () => json({ success: false }, 500);

  renderContent({ claude: { model: 'best', effort: 'max' } });

  const trigger = await screen.findByRole('button', { name: /default model/i });
  await waitFor(() => expect((trigger as HTMLButtonElement).disabled).toBe(true));
  expect(await screen.findByText(/could not load this provider/i)).toBeTruthy();
});
