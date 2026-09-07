import assert from 'node:assert/strict';

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import JSZip from 'jszip';
import React, { useEffect } from 'react';
import { beforeEach, test, vi } from 'vitest';

import { ThemeProvider, useTheme } from '@/shared/context/ThemeContext';
import type { ThemeSearchResult } from '@/shared/types';
import { readUserPreference, resetUserPreferences } from '@/shared/userSettings';
import AddThemeDialog from '@/modules/settings/tabs/appearance-settings/AddThemeDialog';

/**
 * The add-theme dialog: recommended themes, Open VSX rankings and searches that
 * install and update extensions, a pasted extension link installed directly,
 * and pasted JSON.
 * Without an i18n instance `t` returns its key, which is what these query.
 */

const { search, downloadExtension } = vi.hoisted(() => ({
  search: vi.fn(),
  downloadExtension: vi.fn(),
}));

vi.mock('@/shared/api', () => ({
  api: { themes: { search, downloadExtension } },
  readApiJson: async (response: Response) => {
    const body = await response.json();
    if (!response.ok) {
      throw new Error(body?.error?.message ?? 'failed');
    }
    return body;
  },
  readApiErrorMessage: (body: { error?: { message?: string } } | null) => body?.error?.message ?? null,
}));

const KEY = 'appearanceSettings.colorTheme.add';

const result = (overrides: Partial<ThemeSearchResult> = {}): ThemeSearchResult => ({
  id: 'acme.night-theme',
  namespace: 'acme',
  name: 'night-theme',
  displayName: 'Night Theme',
  description: 'A theme for the night',
  downloadCount: 602_776,
  version: '2.0.0',
  iconUrl: null,
  sourceUrl: 'https://github.com/acme/night',
  url: 'https://open-vsx.org/extension/acme/night-theme',
  ...overrides,
});

const searchResponse = (extensions: ThemeSearchResult[]) =>
  new Response(JSON.stringify({ success: true, data: { extensions } }), { status: 200 });

/** A real `.vsix` contributing the named dark themes, so the dialog's parsing runs for real. */
async function vsix(names: string[]): Promise<Response> {
  const archive = new JSZip();
  archive.file('extension/package.json', JSON.stringify({
    name: 'night-theme',
    contributes: { themes: names.map((label, index) => ({ label, uiTheme: 'vs-dark', path: `./themes/${index}.json` })) },
  }));
  names.forEach((name, index) => {
    archive.file(`extension/themes/${index}.json`, JSON.stringify({
      name,
      type: 'dark',
      colors: { 'editor.background': '#1e1e2e', 'editor.foreground': '#cdd6f4' },
    }));
  });
  return new Response(await archive.generateAsync({ type: 'arraybuffer' }), { status: 200 });
}

let theme: ReturnType<typeof useTheme>;
function ThemeProbe() {
  const value = useTheme();
  // Published from an effect: assigning outside the component during render is a side effect.
  useEffect(() => {
    theme = value;
  });
  return null;
}

function renderDialog() {
  const onOpenChange = vi.fn();
  render(
    <ThemeProvider>
      <ThemeProbe />
      <AddThemeDialog open onOpenChange={onOpenChange} />
    </ThemeProvider>,
  );
  return { onOpenChange };
}

const typeQuery = (text: string) => {
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: text } });
};

beforeEach(() => {
  localStorage.clear();
  resetUserPreferences();
  search.mockReset();
  downloadExtension.mockReset();
});

test('a search lists colour themes and passes the chosen sort along', async () => {
  search.mockImplementation(async () => searchResponse([result()]));
  renderDialog();

  typeQuery('night');

  await screen.findByText('Night Theme');
  assert.deepEqual(search.mock.calls[0].slice(0, 2), ['night', 'relevance']);
  assert.ok(screen.getByText('acme'), 'the publisher is shown');
  assert.equal(screen.getByRole('link', { name: /Night Theme/ }).getAttribute('href'), 'https://github.com/acme/night');

  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'rating' } });
  await waitFor(() => assert.deepEqual(search.mock.calls.at(-1)?.slice(0, 2), ['night', 'rating']));
});

test('the most popular themes are listed without typing anything', async () => {
  search.mockImplementation(async () => searchResponse([result()]));
  renderDialog();

  assert.equal(search.mock.calls.length, 0, 'the recommended list needs no request');
  fireEvent.click(screen.getByRole('button', { name: `${KEY}.browse.downloadCount` }));

  await screen.findByText('Night Theme');
  assert.deepEqual(search.mock.calls[0].slice(0, 2), ['', 'downloadCount']);
});

test('a recommended theme installs from Open VSX in one click', async () => {
  downloadExtension.mockImplementation(() => vsix(['Mocha']));
  renderDialog();

  // The name and the publisher both read "Catppuccin".
  const card = screen.getAllByText('Catppuccin')[0].closest('li') as HTMLElement;
  fireEvent.click(within(card).getByRole('button', { name: `${KEY}.search.install` }));

  await within(card).findByText(`${KEY}.search.installed`);
  assert.equal(downloadExtension.mock.calls[0][0], 'https://open-vsx.org/extension/Catppuccin/catppuccin-vsc');
  assert.deepEqual(theme.availableThemes.find((entry) => entry.source)?.source, {
    extensionId: 'Catppuccin.catppuccin-vsc',
    displayName: 'Catppuccin',
  });
});

test('installing puts the new theme in the slot its appearance fits', async () => {
  search.mockImplementation(async () => searchResponse([result()]));
  downloadExtension.mockImplementation(() => vsix(['Night', 'Midnight']));
  renderDialog();

  typeQuery('night');
  fireEvent.click(await screen.findByRole('button', { name: `${KEY}.search.install` }));

  await screen.findByText(`${KEY}.search.installed`);
  assert.equal(downloadExtension.mock.calls[0][0], 'https://open-vsx.org/extension/acme/night-theme');
  const installed = theme.availableThemes.filter((entry) => entry.source);
  assert.deepEqual(installed.map((entry) => entry.name), ['Night', 'Midnight']);
  assert.deepEqual(installed[0].source, { extensionId: 'acme.night-theme', version: '2.0.0', displayName: 'Night Theme' });
  // Light mode is showing and the extension is dark only, so it fills the dark slot.
  assert.equal(theme.activeSlot, 'light');
  assert.deepEqual(theme.slotThemes, { light: 'default', dark: installed[0].id });
});

test('an older installed version is offered as an update, which leaves the slots alone', async () => {
  search.mockImplementation(async () => searchResponse([result({ version: '2.0.0' })]));
  downloadExtension.mockImplementation(() => vsix(['Night']));
  renderDialog();

  let previousIds: string[] = [];
  act(() => {
    previousIds = theme.installImportedThemes(
      [{
        id: 'imported-night-old',
        name: 'Night',
        appearance: 'dark',
        previewColors: ['#000000', '#111111', '#222222'],
        tokens: { background: '0 0% 8%' },
      }],
      { extensionId: 'acme.night-theme', version: '1.0.0' },
    );
  });

  typeQuery('night');
  fireEvent.click(await screen.findByRole('button', { name: `${KEY}.search.update` }));

  await screen.findByText(`${KEY}.search.installed`);
  const installed = theme.availableThemes.filter((entry) => entry.source);
  assert.deepEqual(installed.map((entry) => entry.id), previousIds, 'updated in place, not duplicated');
  assert.equal(installed[0].source?.version, '2.0.0');
  assert.deepEqual(theme.slotThemes, { light: 'default', dark: 'default' });
});

test('a pasted Open VSX link is installed directly instead of searched for', async () => {
  downloadExtension.mockImplementation(() => vsix(['Night']));
  renderDialog();

  typeQuery('https://open-vsx.org/extension/acme/night-theme');
  fireEvent.click(screen.getByRole('button', { name: `${KEY}.search.install` }));

  await waitFor(() => assert.equal(theme.availableThemes.filter((entry) => entry.source).length, 1));
  assert.equal(search.mock.calls.length, 0);
  assert.equal(theme.availableThemes.find((entry) => entry.source)?.source?.extensionId, 'acme.night-theme');
});

test('a failed install explains itself and keeps the dialog open', async () => {
  search.mockImplementation(async () => searchResponse([result()]));
  downloadExtension.mockImplementation(async () => new Response(
    JSON.stringify({ success: false, error: { message: 'That extension could not be downloaded' } }),
    { status: 502 },
  ));
  const { onOpenChange } = renderDialog();

  typeQuery('night');
  fireEvent.click(await screen.findByRole('button', { name: `${KEY}.search.install` }));

  assert.equal((await screen.findByRole('alert')).textContent, 'That extension could not be downloaded');
  assert.equal(onOpenChange.mock.calls.length, 0);
});

test('a search Open VSX cannot answer says so instead of showing no results', async () => {
  search.mockImplementation(async () => new Response(JSON.stringify({ success: false }), { status: 502 }));
  renderDialog();

  typeQuery('night');

  await screen.findByText(`${KEY}.search.failed`);
});

test('pasted VS Code JSON is added to its slot and closes the dialog', async () => {
  const { onOpenChange } = renderDialog();

  fireEvent.click(screen.getByRole('tab', { name: `${KEY}.tabs.import` }));
  fireEvent.change(screen.getByRole('textbox', { name: new RegExp(`${KEY}.json.label`) }), {
    target: {
      value: JSON.stringify({ name: 'Pasted', type: 'light', colors: { 'editor.background': '#ffffff', 'editor.foreground': '#000000' } }),
    },
  });
  fireEvent.click(screen.getByRole('button', { name: `${KEY}.submit` }));

  const pasted = theme.availableThemes.find((entry) => entry.name === 'Pasted');
  assert.ok(pasted);
  assert.equal(pasted.source, undefined);
  assert.equal(theme.slotThemes.light, pasted.id);
  assert.equal(readUserPreference('lightColorTheme', null), pasted.id);
  assert.deepEqual(onOpenChange.mock.calls.at(-1), [false]);
});

test('the dialog opens above Settings and takes Escape away from it', () => {
  renderDialog();

  const dialog = screen.getByRole('dialog');
  assert.ok(dialog.hasAttribute('data-escape-layer'), 'Settings ignores Escape while an escape layer is open');
  assert.ok(dialog.parentElement?.className.includes('z-[10000]'), 'Settings sits at z-[9999]');
});
