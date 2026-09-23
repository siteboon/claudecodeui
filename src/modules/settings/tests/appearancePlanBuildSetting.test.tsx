import assert from 'node:assert/strict';

import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, test, vi } from 'vitest';

import '@/modules/i18n';
import AppearanceSettingsTab from '@/modules/settings/tabs/AppearanceSettingsTab';
import { ThemeProvider } from '@/shared/context/ThemeContext';
import { UiPreferencesProvider } from '@/shared/context/UiPreferencesContext';
import { readUserPreference, resetUserPreferences } from '@/shared/userSettings';

/**
 * Issue #1403: "Build approved plans in" decides what the plan card's main
 * Build button and ⌘↩ do. Same session stays the default so nothing changes
 * for current users; the choice is a UI preference that follows the account.
 */

beforeEach(() => {
  localStorage.clear();
  resetUserPreferences();
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } })));
});

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
  resetUserPreferences();
});

const renderTab = () => render(
  <ThemeProvider>
    <UiPreferencesProvider>
      <AppearanceSettingsTab
        projectSortOrder="name"
        onProjectSortOrderChange={() => undefined}
        codeEditorSettings={{ wordWrap: false, showMinimap: true, lineNumbers: true, fontSize: '14' }}
        onCodeEditorWordWrapChange={() => undefined}
        onCodeEditorShowMinimapChange={() => undefined}
        onCodeEditorLineNumbersChange={() => undefined}
        onCodeEditorFontSizeChange={() => undefined}
      />
    </UiPreferencesProvider>
  </ThemeProvider>,
);

test('plans are built in the same session until the user picks a new session', () => {
  renderTab();

  const select = screen.getByRole('combobox', { name: 'Build approved plans in' }) as HTMLSelectElement;
  assert.equal(select.value, 'same');
  assert.deepEqual(
    Array.from(select.options).map((option) => option.textContent),
    ['Same session', 'New session'],
  );

  fireEvent.change(select, { target: { value: 'new' } });

  assert.equal(select.value, 'new');
  assert.equal(
    readUserPreference<Record<string, unknown>>('uiPreferences', {}).buildPlansInNewSession,
    true,
  );
});
