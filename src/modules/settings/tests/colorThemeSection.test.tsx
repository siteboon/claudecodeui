import assert from 'node:assert/strict';

import { fireEvent, render, screen, within } from '@testing-library/react';
import React, { useEffect } from 'react';
import { beforeEach, test, vi } from 'vitest';

import { ThemeProvider, useTheme } from '@/shared/context/ThemeContext';
import type { ColorTheme } from '@/shared/types';
import { resetUserPreferences, writeUserPreference } from '@/shared/userSettings';
import ColorThemeSection from '@/modules/settings/tabs/appearance-settings/ColorThemeSection';

/**
 * The theme picker: a light and a dark slot, each filled from the installed
 * themes that fit it, listed one extension at a time rather than one tile per
 * variant. Without an i18n instance `t` returns its key, which is what these query.
 */

vi.mock('@/shared/api', () => ({
  api: { themes: { search: vi.fn(), downloadExtension: vi.fn() } },
  readApiJson: vi.fn(),
  readApiErrorMessage: vi.fn(),
}));

const KEY = 'appearanceSettings.colorTheme';

const catppuccin = { extensionId: 'Catppuccin.catppuccin-vsc', version: '3.19.0', displayName: 'Catppuccin' };
const variant = (id: string, name: string, appearance: 'light' | 'dark'): ColorTheme => ({
  id,
  name,
  appearance,
  previewColors: ['#000000', '#111111', '#cba6f7'],
  tokens: { background: appearance === 'dark' ? '0 0% 8%' : '0 0% 96%' },
  source: catppuccin,
});

let theme: ReturnType<typeof useTheme>;
function ThemeProbe() {
  const value = useTheme();
  useEffect(() => {
    theme = value;
  });
  return null;
}

function renderSection() {
  render(
    <ThemeProvider>
      <ThemeProbe />
      <ColorThemeSection />
    </ThemeProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  resetUserPreferences();
  writeUserPreference('theme', 'light');
  writeUserPreference('importedThemes', [
    variant('imported-latte', 'Latte', 'light'),
    variant('imported-mocha', 'Mocha', 'dark'),
    variant('imported-frappe', 'Frappé', 'dark'),
  ]);
});

const groupCard = (name: string) => screen.getByText(name, { selector: 'span.font-semibold' }).closest('div.relative') as HTMLElement;

test('an extension is one group, showing only the variants that fit the edited slot', () => {
  renderSection();

  // The light slot is edited first, since light mode is showing.
  assert.ok(within(groupCard('Catppuccin')).getByRole('button', { name: /Latte/ }));
  assert.equal(within(groupCard('Catppuccin')).queryByRole('button', { name: /Mocha/ }), null);

  fireEvent.click(screen.getByRole('button', { name: new RegExp(`${KEY}.slots.dark`) }));

  const darkVariants = within(groupCard('Catppuccin')).getAllByRole('button', { pressed: false }).map((button) => button.textContent);
  assert.ok(darkVariants.some((label) => label?.includes('Mocha')));
  assert.ok(darkVariants.some((label) => label?.includes('Frappé')));
});

test('picking a variant fills the edited slot', () => {
  renderSection();

  fireEvent.click(screen.getByRole('button', { name: new RegExp(`${KEY}.slots.dark`) }));
  fireEvent.click(within(groupCard('Catppuccin')).getByRole('button', { name: /Mocha/ }));

  assert.deepEqual(theme.slotThemes, { light: 'default', dark: 'imported-mocha' });
  assert.equal(document.documentElement.dataset.theme, 'default', 'light mode is still showing');
});

test('removing an extension asks first, then drops every variant and frees the slots', () => {
  renderSection();
  fireEvent.click(within(groupCard('Catppuccin')).getByRole('button', { name: /Latte/ }));

  fireEvent.click(within(groupCard('Catppuccin')).getByRole('button', { name: `${KEY}.remove: Catppuccin` }));
  assert.equal(theme.availableThemes.length, 4, 'the first press only asks');

  fireEvent.click(screen.getByRole('button', { name: `${KEY}.removeButton` }));

  assert.deepEqual(theme.availableThemes.map((entry) => entry.id), ['default']);
  assert.deepEqual(theme.slotThemes, { light: 'default', dark: 'default' });
});

test('the mode chosen at the top of the section shows its slot and edits it', () => {
  renderSection();

  fireEvent.change(screen.getByRole('combobox', { name: 'appearanceSettings.theme.label' }), { target: { value: 'dark' } });

  assert.equal(theme.themeMode, 'dark');
  assert.equal(theme.activeSlot, 'dark');
  assert.equal(screen.getByRole('button', { name: new RegExp(`${KEY}.slots.dark`) }).getAttribute('aria-pressed'), 'true');
  assert.ok(screen.getByText(`${KEY}.list.darkTitle`));
});
