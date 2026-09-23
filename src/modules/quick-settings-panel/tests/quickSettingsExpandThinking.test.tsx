import assert from 'node:assert/strict';

import { fireEvent, render, screen } from '@testing-library/react';
import { test } from 'vitest';

import '@/modules/i18n';
import QuickSettingsContent from '@/modules/quick-settings-panel/QuickSettingsContent';
import { ThemeProvider } from '@/shared/context/ThemeContext';
import type { PreferenceToggleKey, QuickSettingsPreferences } from '@/shared/types';

/**
 * The drawer's "Expand thinking" row writes the expandThinking preference the
 * transcript reads. It only makes sense while thinking rows are shown at all,
 * so it drops out of the list when "Show thinking" is off, the way the voice
 * row drops out when voice is disabled.
 */

const PREFERENCES: QuickSettingsPreferences = {
  showRawParameters: false,
  showThinking: true,
  expandThinking: false,
  sendByCtrlEnter: false,
  voiceEnabled: false,
};

// DarkModeToggle reads the theme, so the real provider is needed.
const renderDrawer = (
  preferences: Partial<QuickSettingsPreferences> = {},
  onPreferenceChange: (key: PreferenceToggleKey, value: boolean) => void = () => {},
) =>
  render(
    <ThemeProvider>
      <QuickSettingsContent
        isDarkMode={false}
        preferences={{ ...PREFERENCES, ...preferences }}
        onPreferenceChange={onPreferenceChange}
      />
    </ThemeProvider>,
  );

test('the Expand thinking row sits under Tool Display and writes expandThinking', () => {
  const changes: Array<[PreferenceToggleKey, boolean]> = [];
  renderDrawer({}, (key, value) => changes.push([key, value]));

  const toolDisplay = screen.getByText('Tool Display').parentElement;
  assert.ok(toolDisplay?.textContent?.includes('Expand thinking'), 'expected the row in the Tool Display section');

  fireEvent.click(screen.getByLabelText('Expand thinking'));

  assert.deepEqual(changes, [['expandThinking', true]]);
});

test('the Expand thinking row reflects the stored preference', () => {
  renderDrawer({ expandThinking: true });

  assert.equal((screen.getByLabelText('Expand thinking') as HTMLInputElement).checked, true);
});

test('the Expand thinking row is hidden while thinking rows are hidden', () => {
  renderDrawer({ showThinking: false });

  assert.equal(screen.queryByLabelText('Expand thinking'), null);
  assert.ok(screen.getByLabelText('Show thinking'), 'Show thinking stays so it can be turned back on');
});
